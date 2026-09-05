import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  PHYSICS_COLLISION_EXPERIMENT_VERSION,
  type PhysicsCollisionVariantId,
} from '../apps/web/src/game/physics-collision-experiment'
import {
  ROLLING_CPU_PROFILE_VERSION,
  type RollingCpuExactStepSample,
  type RollingCpuProfileSnapshot,
} from '../apps/web/src/game/performance-profile'
import {
  readRepositoryState,
  sameRepositoryState,
  type RepositoryState,
} from '../tooling/repository-state'
import {
  BROWSER_BUDGETS,
  collectBrowserIssues,
  expectNoStaticFrames,
  expectRenderBudgets,
  readBrowserMetadata,
  waitForPostRender,
  waitForStaticQuiescence,
  writeBenchArtifact,
  type BrowserIssues,
  type CanonicalBodyStateDiagnostics,
  type DiceRuntimeDiagnostics,
} from './helpers/diagnostics'

const PHYSICS_COLLISION_BROWSER_AB_SCHEMA_VERSION = 1
const BASELINE: PhysicsCollisionVariantId = 'cannon-default'
const CANDIDATE: PhysicsCollisionVariantId = 'projected-aabb-v1'
const SEEDS = [50_000, 55_000, 60_000, 65_000, 70_000] as const
const WARMUP_SEED = 42
const IMPACT_WINDOW_SECONDS = 0.5
const TAIL_WINDOW_SECONDS = 0.5

type PhaseName = 'airborne' | 'impact' | 'tail' | 'whole'
type CpuMetricName = 'narrowphaseCpuMsPerStep' | 'worldStepCpuMsPerStep'
type PercentileName = 'p50' | 'p95'

interface Distribution {
  count: number
  p50: number | null
  p95: number | null
  max: number | null
}

interface PhaseCpuEvidence {
  exactStepCount: number
  mappedWorldStepCount: number
  narrowphaseCpuMsPerStep: Distribution
  worldStepCpuMsPerStep: Distribution
}

type PhaseProfile = Record<PhaseName, PhaseCpuEvidence>

interface RunObservation {
  seed: number
  variant: PhysicsCollisionVariantId
  orderIndex: number
  tilted: boolean
  faces: number[]
  prize: string
  carry: string | null
  settleReason: DiceRuntimeDiagnostics['roll']['settleReason']
  settleElapsed: number | null
  settleWallMs: number
  idle: DiceRuntimeDiagnostics
  rolling: DiceRuntimeDiagnostics
  settled: DiceRuntimeDiagnostics
  phaseProfile: PhaseProfile
  contextLossCount: number
}

interface StatisticComparison {
  baselineValues: number[]
  candidateValues: number[]
  baselineMedian: number | null
  candidateMedian: number | null
  candidateToBaselineRatio: number | null
  baselineRepeatNoise: number | null
  candidateRepeatNoise: number | null
}

interface MetricComparison {
  p50: StatisticComparison
  p95: StatisticComparison
}

interface SeedComparison {
  seed: number
  order: PhysicsCollisionVariantId[]
  strictEquivalent: true
  performance: Record<PhaseName, Record<CpuMetricName, MetricComparison>>
}

function variantOrder(seedIndex: number): PhysicsCollisionVariantId[] {
  return seedIndex % 2 === 0
    ? [BASELINE, CANDIDATE, CANDIDATE, BASELINE]
    : [CANDIDATE, BASELINE, BASELINE, CANDIDATE]
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function distribution(values: readonly number[]): Distribution {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length === 0 ? null : Math.max(...values),
  }
}

function relativeRepeatNoise(values: readonly number[]): number | null {
  if (values.length !== 2) return null
  const center = median(values)
  if (center === null || center === 0) return null
  return Math.abs(values[0] - values[1]) / center
}

function ratio(candidate: number | null, baseline: number | null): number | null {
  return candidate === null || baseline === null || baseline === 0 ? null : candidate / baseline
}

function expectCanonicalState(
  state: CanonicalBodyStateDiagnostics | null,
  context: string,
): asserts state is CanonicalBodyStateDiagnostics {
  expect(state, `${context} canonical state`).not.toBeNull()
  if (!state) throw new Error(`${context} canonical state missing`)
  expect(state).toMatchObject({
    version: 1,
    floatEncoding: 'ieee754-float64-be',
    hashAlgorithm: 'fnv1a64',
    hash: expect.stringMatching(/^[0-9a-f]{16}$/),
  })
  expect(state.bodies, `${context} body count`).toHaveLength(6)
  for (const [bodyIndex, body] of state.bodies.entries()) {
    const fields = [
      ['position', body.position, 3],
      ['quaternion', body.quaternion, 4],
      ['velocity', body.velocity, 3],
      ['angularVelocity', body.angularVelocity, 3],
    ] as const
    for (const [field, values, length] of fields) {
      expect(values, `${context} body ${bodyIndex} ${field}`).toHaveLength(length)
      expect(values.every(Number.isFinite), `${context} body ${bodyIndex} ${field}`).toBe(true)
    }
  }
}

function expectProductionScheduler(diagnostics: DiceRuntimeDiagnostics): void {
  expect(diagnostics.physicsSchedulerExperiment).toEqual({
    version: 1,
    explicit: false,
    variant: 'exact-cap6',
    kind: 'exact-accumulator',
    maxStepsPerFrame: 6,
  })
  expect(diagnostics.engine.physicsTiming).toMatchObject({
    version: 1,
    preset: 'exact-cap6',
    kind: 'exact-accumulator',
    maxStepsPerFrame: 6,
    overload: { active: false },
    suspended: false,
  })
}

function expectProductionRender(
  diagnostics: DiceRuntimeDiagnostics,
  phase: 'static' | 'rolling',
): void {
  expect(diagnostics.renderExperiment).toEqual({
    version: 1,
    explicit: true,
    variant: 'rolling-dpr-1x',
    rollingDprPreset: 'cap-1x',
    rollingShadowPreset: 'every-frame',
  })
  expect(diagnostics.render.quality).toMatchObject({
    phase,
    rollingDprPreset: 'cap-1x',
  })
  expect(diagnostics.engine.rollingShadow.preset).toBe('every-frame')
}

function expectCollisionExperiment(
  diagnostics: DiceRuntimeDiagnostics,
  variant: PhysicsCollisionVariantId,
): void {
  expect(diagnostics.physicsCollisionExperiment).toEqual({
    version: PHYSICS_COLLISION_EXPERIMENT_VERSION,
    explicit: true,
    variant,
  })
}

function expectIdleTiming(diagnostics: DiceRuntimeDiagnostics): void {
  const timing = diagnostics.engine.physicsTiming
  expect(timing).toMatchObject({
    simulationStep: null,
    simulationTime: null,
    totalRawWallDeltaMs: 0,
    totalAcceptedWallDeltaMs: 0,
    totalPausedWallDeltaMs: 0,
    totalDiscardedWallDeltaMs: 0,
    totalExecutedSteps: 0,
    queuedMs: 0,
    queuedWholeSteps: 0,
    interpolationAlpha: 0,
    terminalAbandoned: null,
  })
}

function expectSettledTimingConservation(diagnostics: DiceRuntimeDiagnostics): void {
  const timing = diagnostics.engine.physicsTiming
  expect(timing.simulationStep).not.toBeNull()
  expect(timing.simulationStep!).toBeGreaterThan(0)
  expect(timing.totalExecutedSteps).toBe(timing.simulationStep)
  expect(diagnostics.engine.physicsStepCount).toBe(timing.totalExecutedSteps)
  expect(timing.simulationTime).toBeCloseTo(
    timing.totalExecutedSteps * (timing.fixedStepMs / 1_000),
    9,
  )
  expect(timing.totalRawWallDeltaMs).toBeCloseTo(
    timing.totalAcceptedWallDeltaMs + timing.totalDiscardedWallDeltaMs,
    8,
  )
  expect(timing.totalPausedWallDeltaMs).toBe(0)
  expect(timing.terminalAbandoned).toMatchObject({ reason: 'settled' })
  expect(timing.queuedMs).toBeCloseTo(timing.terminalAbandoned!.queuedMs, 9)
  expect(timing.queuedWholeSteps).toBe(timing.terminalAbandoned!.queuedWholeSteps)
  expect(timing.interpolationAlpha).toBeCloseTo(timing.terminalAbandoned!.interpolationAlpha, 9)
  expect(timing.totalAcceptedWallDeltaMs).toBeCloseTo(
    timing.totalExecutedSteps * timing.fixedStepMs + timing.terminalAbandoned!.queuedMs,
    7,
  )
}

function expectRollSafety(diagnostics: DiceRuntimeDiagnostics): void {
  const safety = diagnostics.engine.rollSafety
  expect(safety.nonFiniteBodyStateDetected).toBe(false)
  expect(safety.escapeGuardInterventionCount).toBe(0)
  expect(safety.wallCenterCrossings).toBe(0)
  expect(safety.conservativeBoundaryCrossings).toBe(0)
  expect(safety.maxRadius).toBeLessThan(safety.containmentRadius)
  expect(safety.maxContactPenetration).toBeLessThanOrEqual(0.1)
  expect(diagnostics.roll.settleReason).toMatch(
    /^(natural-sleep|stable-window|pose-stable-window)$/,
  )
}

function validateExactStep(sample: RollingCpuExactStepSample, index: number): void {
  expect(sample.simulationStep).toBe(index + 1)
  expect(sample.simulationTime).toBeGreaterThan(0)
  for (const value of [
    sample.contactCount,
    sample.contactEquationCount,
    sample.frictionEquationCount,
    sample.awakeDiceCount,
    sample.broadphaseCpuMs,
    sample.narrowphaseCpuMs,
    sample.makeContactConstraintsCpuMs,
    sample.solveCpuMs,
    sample.integrateCpuMs,
  ]) {
    expect(Number.isFinite(value)).toBe(true)
    expect(value).toBeGreaterThanOrEqual(0)
  }
}

function phaseMatches(
  phase: PhaseName,
  sample: RollingCpuExactStepSample,
  firstContact: RollingCpuExactStepSample,
  settlement: RollingCpuExactStepSample,
): boolean {
  if (phase === 'whole') return true
  if (phase === 'airborne') return sample.simulationStep < firstContact.simulationStep
  if (phase === 'impact') {
    return (
      sample.simulationStep >= firstContact.simulationStep &&
      sample.simulationTime <= firstContact.simulationTime + IMPACT_WINDOW_SECONDS
    )
  }
  return sample.simulationTime >= settlement.simulationTime - TAIL_WINDOW_SECONDS
}

function derivePhaseProfile(profile: RollingCpuProfileSnapshot): PhaseProfile {
  expect(profile).toMatchObject({
    version: ROLLING_CPU_PROFILE_VERSION,
    sampleKind: 'rolling-cpu',
    rendererTimingKind: 'cpu-submit',
  })
  expect(profile.totalExactStepCount).toBeGreaterThan(0)
  expect(profile.retainedExactStepCount).toBe(profile.totalExactStepCount)
  expect(profile.exactStepSamples).toHaveLength(profile.totalExactStepCount)
  profile.exactStepSamples.forEach(validateExactStep)

  const firstContact = profile.exactStepSamples.find(({ contactCount }) => contactCount > 0)
  const settlements = profile.exactStepSamples.filter(({ settled }) => settled)
  expect(firstContact, 'collision A/B profile must observe first contact').toBeDefined()
  expect(settlements, 'collision A/B profile must observe one settlement').toHaveLength(1)
  if (!firstContact || settlements.length !== 1) {
    throw new Error('collision A/B phase boundaries unavailable')
  }
  const settlement = settlements[0]
  expect(settlement.simulationStep).toBe(profile.totalExactStepCount)

  const worldStepPerSimulationStep = new Map<number, number>()
  for (const frame of profile.rawFrameSamples) {
    if (frame.executedSteps === 0) continue
    expect(frame.simulationStep, 'profiled exact frame must publish simulationStep').not.toBeNull()
    expect(frame.worldStepCpuMs).toBeGreaterThanOrEqual(0)
    const endStep = frame.simulationStep!
    const startStep = endStep - frame.executedSteps + 1
    const perStep = frame.worldStepCpuMs / frame.executedSteps
    for (let step = startStep; step <= endStep; step++) {
      expect(worldStepPerSimulationStep.has(step), `simulation step ${step} mapped twice`).toBe(
        false,
      )
      worldStepPerSimulationStep.set(step, perStep)
    }
  }

  const phases = ['airborne', 'impact', 'tail', 'whole'] as const
  return Object.fromEntries(
    phases.map((phase) => {
      const exactSteps = profile.exactStepSamples.filter((sample) =>
        phaseMatches(phase, sample, firstContact, settlement),
      )
      const worldStepValues = exactSteps.flatMap((sample) => {
        const value = worldStepPerSimulationStep.get(sample.simulationStep)
        return value === undefined ? [] : [value]
      })
      return [
        phase,
        {
          exactStepCount: exactSteps.length,
          mappedWorldStepCount: worldStepValues.length,
          narrowphaseCpuMsPerStep: distribution(
            exactSteps.map(({ narrowphaseCpuMs }) => narrowphaseCpuMs),
          ),
          worldStepCpuMsPerStep: distribution(worldStepValues),
        },
      ]
    }),
  ) as PhaseProfile
}

function throwEvidence(diagnostics: DiceRuntimeDiagnostics): Record<string, unknown> {
  return {
    seed: diagnostics.roll.seed,
    throwAlgorithmVersion: diagnostics.roll.throwAlgorithmVersion,
    placementAlgorithm: diagnostics.roll.placementAlgorithm,
    placementAttempts: diagnostics.roll.placementAttempts,
    placementRestarts: diagnostics.roll.placementRestarts,
    placementGroupAttempts: diagnostics.roll.placementGroupAttempts,
    randomPlanVersion: diagnostics.roll.randomPlanVersion,
    placementPath: diagnostics.roll.placementPath,
    fallbackLayout: diagnostics.roll.fallbackLayout,
  }
}

function strictEvidence(observation: RunObservation): string {
  const { settled } = observation
  return JSON.stringify({
    throw: throwEvidence(settled),
    initialState: settled.roll.initialState,
    finalState: settled.roll.finalState,
    result: {
      tilted: observation.tilted,
      faces: observation.faces,
      prize: observation.prize,
      carry: observation.carry,
      settleReason: observation.settleReason,
      settleElapsed: observation.settleElapsed,
    },
    simulation: {
      simulationStep: settled.engine.physicsTiming.simulationStep,
      simulationTime: settled.engine.physicsTiming.simulationTime,
    },
    rollSafety: settled.engine.rollSafety,
    renderStructure: {
      mainPassCalls: settled.render.mainPassCalls,
      mainPassTriangles: settled.render.mainPassTriangles,
      geometries: settled.render.geometries,
      textures: settled.render.textures,
      programs: settled.render.programs,
    },
  })
}

function artifactRunEvidence(observation: RunObservation): Record<string, unknown> {
  const { settled } = observation
  return {
    seed: observation.seed,
    variant: observation.variant,
    orderIndex: observation.orderIndex,
    result: {
      tilted: observation.tilted,
      faces: observation.faces,
      prize: observation.prize,
      carry: observation.carry,
      settleReason: observation.settleReason,
      settleElapsed: observation.settleElapsed,
      settleWallMs: observation.settleWallMs,
    },
    throw: throwEvidence(settled),
    initialState: settled.roll.initialState,
    finalState: settled.roll.finalState,
    physicsTiming: settled.engine.physicsTiming,
    rollSafety: settled.engine.rollSafety,
    render: settled.render,
    phaseProfile: observation.phaseProfile,
    contextLossCount: observation.contextLossCount,
  }
}

function statisticComparison(
  baselineRuns: readonly RunObservation[],
  candidateRuns: readonly RunObservation[],
  phase: PhaseName,
  metric: CpuMetricName,
  percentileName: PercentileName,
): StatisticComparison {
  const read = (run: RunObservation): number | null =>
    run.phaseProfile[phase][metric][percentileName]
  const baselineValues = baselineRuns.map(read).filter((value): value is number => value !== null)
  const candidateValues = candidateRuns.map(read).filter((value): value is number => value !== null)
  const baselineMedian = median(baselineValues)
  const candidateMedian = median(candidateValues)
  return {
    baselineValues,
    candidateValues,
    baselineMedian,
    candidateMedian,
    candidateToBaselineRatio: ratio(candidateMedian, baselineMedian),
    baselineRepeatNoise: relativeRepeatNoise(baselineValues),
    candidateRepeatNoise: relativeRepeatNoise(candidateValues),
  }
}

function compareSeed(
  seed: number,
  order: PhysicsCollisionVariantId[],
  observations: readonly RunObservation[],
): SeedComparison {
  expect(new Set(observations.map(strictEvidence)).size, `seed ${seed} strict result drift`).toBe(1)
  const baselineRuns = observations.filter(({ variant }) => variant === BASELINE)
  const candidateRuns = observations.filter(({ variant }) => variant === CANDIDATE)
  expect(baselineRuns).toHaveLength(2)
  expect(candidateRuns).toHaveLength(2)

  const phases = ['airborne', 'impact', 'tail', 'whole'] as const
  const metrics = ['narrowphaseCpuMsPerStep', 'worldStepCpuMsPerStep'] as const
  const performance = Object.fromEntries(
    phases.map((phase) => [
      phase,
      Object.fromEntries(
        metrics.map((metric) => [
          metric,
          {
            p50: statisticComparison(baselineRuns, candidateRuns, phase, metric, 'p50'),
            p95: statisticComparison(baselineRuns, candidateRuns, phase, metric, 'p95'),
          },
        ]),
      ),
    ]),
  ) as SeedComparison['performance']

  return { seed, order, strictEquivalent: true, performance }
}

async function runVariant(
  page: Page,
  testInfo: TestInfo,
  issues: BrowserIssues,
  seed: number,
  variant: PhysicsCollisionVariantId,
  orderIndex: number,
): Promise<RunObservation> {
  const issueOffsets = {
    consoleErrors: issues.consoleErrors.length,
    pageErrors: issues.pageErrors.length,
  }
  const query = new URLSearchParams({
    nextSeed: String(seed),
    perfProfile: '1',
    perfProfileVersion: String(ROLLING_CPU_PROFILE_VERSION),
    physicsCollisionExperimentVersion: String(PHYSICS_COLLISION_EXPERIMENT_VERSION),
    physicsCollisionVariant: variant,
    renderExperimentVersion: '1',
    renderVariant: 'rolling-dpr-1x',
  })
  await page.goto(`/?${query}`)
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '掷骰' })).toBeVisible()

  let idle = await waitForPostRender(page, { mode: 'idle', frameScheduled: false })
  idle = await waitForStaticQuiescence(page, idle)
  expectProductionScheduler(idle)
  expectProductionRender(idle, 'static')
  expectCollisionExperiment(idle, variant)
  expectIdleTiming(idle)
  expectRenderBudgets(idle, testInfo.project.name)
  await expectNoStaticFrames(page, idle)
  await page.evaluate(() => {
    const state = window as typeof window & { __diceWebglContextLossCount?: number }
    state.__diceWebglContextLossCount = 0
    document.querySelector('canvas')?.addEventListener('webglcontextlost', () => {
      state.__diceWebglContextLossCount = (state.__diceWebglContextLossCount ?? 0) + 1
    })
  })

  const settleStartedAt = performance.now()
  await page.getByRole('button', { name: '掷骰' }).click()
  const rolling = await waitForPostRender(page, {
    mode: 'rolling',
    afterRevision: idle.revision,
    afterRenderCount: idle.engine.renderCount,
    frameScheduled: true,
  })
  expect(rolling.roll.seed).toBe(seed)
  expectProductionScheduler(rolling)
  expectProductionRender(rolling, 'rolling')
  expectCollisionExperiment(rolling, variant)
  expectRenderBudgets(rolling, testInfo.project.name)

  const terminalUi = page.locator('.result-panel, .tilt-warning, [role="alert"]')
  await expect(terminalUi).toBeVisible({ timeout: BROWSER_BUDGETS.settlementWallTimeoutMs })
  await expect(page.getByRole('alert'), `${variant} must not terminate as an error`).toHaveCount(0)
  const tilted = await page.locator('.tilt-warning').isVisible()
  if (tilted) await page.getByRole('button', { name: '接受结果' }).click()
  await expect(page.locator('.result-panel')).toBeVisible()

  const settled = await waitForPostRender(page, {
    mode: 'settled',
    afterRevision: rolling.revision,
    afterRenderCount: rolling.engine.renderCount,
    frameScheduled: false,
    timeout: BROWSER_BUDGETS.settlementWallTimeoutMs,
  })
  const settleWallMs = performance.now() - settleStartedAt
  expectProductionScheduler(settled)
  expectProductionRender(settled, 'static')
  expectCollisionExperiment(settled, variant)
  expectSettledTimingConservation(settled)
  expectRollSafety(settled)
  expectCanonicalState(settled.roll.initialState, `${variant} seed ${seed} initial`)
  expectCanonicalState(settled.roll.finalState, `${variant} seed ${seed} final`)
  expectRenderBudgets(settled, testInfo.project.name)
  const profile = settled.engine.performanceProfile
  expect(profile, 'collision A/B must publish profile v2').toBeDefined()
  if (!profile) throw new Error('collision A/B profile missing')
  expect(profile.totalExactStepCount).toBe(settled.engine.physicsTiming.totalExecutedSteps)
  const phaseProfile = derivePhaseProfile(profile)

  expect(settled.engine.rollingShadow.rollingRenderFrameCount).toBeGreaterThan(0)
  expect(settled.engine.rollingShadow.rollingShadowUpdateRequestCount).toBe(
    settled.engine.rollingShadow.rollingRenderFrameCount,
  )
  expect(settled.engine.rollingShadow.maxConsecutiveRollingFramesWithoutShadowUpdateRequest).toBe(0)

  const faces = await page
    .locator('.result-panel [aria-label^="骰子点数 "]')
    .evaluateAll((elements) =>
      elements.map((element) => Number(element.getAttribute('aria-label')?.match(/[1-6]$/)?.[0])),
    )
  expect(faces).toHaveLength(6)
  expect(faces.every((face) => Number.isInteger(face) && face >= 1 && face <= 6)).toBe(true)
  await expect(page.locator('.round-display-value')).toHaveText('第 2 轮')
  await expect(page.locator('.history-item')).toHaveCount(1)

  const carryLocator = page.locator('.result-carry')
  const observation: RunObservation = {
    seed,
    variant,
    orderIndex,
    tilted,
    faces,
    prize: (await page.locator('.result-prize').innerText()).trim(),
    carry:
      (await carryLocator.count()) > 0
        ? ((await carryLocator.textContent())?.trim() ?? null)
        : null,
    settleReason: settled.roll.settleReason,
    settleElapsed: settled.roll.settleElapsed,
    settleWallMs,
    idle,
    rolling,
    settled,
    phaseProfile,
    contextLossCount: await page.evaluate(
      () =>
        (window as typeof window & { __diceWebglContextLossCount?: number })
          .__diceWebglContextLossCount ?? 0,
    ),
  }

  expect(observation.contextLossCount).toBe(0)
  expect(issues.pageErrors.slice(issueOffsets.pageErrors), 'new page errors').toEqual([])
  expect(issues.consoleErrors.slice(issueOffsets.consoleErrors), 'new console errors').toEqual([])
  await expectNoStaticFrames(page, settled)
  return observation
}

test('@physics-collision-ab cannon-default vs projected-aabb-v1', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(600_000)
  const issues = collectBrowserIssues(page)
  const runs: RunObservation[] = []
  const pairs: SeedComparison[] = []
  const artifact: Record<string, unknown> = {
    schemaVersion: PHYSICS_COLLISION_BROWSER_AB_SCHEMA_VERSION,
    comparison: { baseline: BASELINE, candidate: CANDIDATE },
    project: testInfo.project.name,
    browserVersion: browser.version(),
    seeds: SEEDS,
    executionPattern: 'ABBA/BAAB alternating by seed',
    fixedRuntimeContracts: {
      scheduler: 'exact-cap6 production default; no scheduler experiment query',
      render:
        'explicit rolling-dpr-1x for both variants; adaptive quality excluded from collision comparison',
      profileVersion: ROLLING_CPU_PROFILE_VERSION,
    },
    equivalencePolicy:
      'hard gate complete throw plan, initial/final canonical state arrays and hashes, faces/prize/carry/tilt, settlement reason/time, simulation step/time, roll safety, and render structure',
    performancePolicy: {
      mode: 'observational-only-no-cross-machine-absolute-ms-threshold',
      phaseBoundaries:
        'exactStepSamples: before first contact; first contact through +500ms; final 500ms; whole roll. Impact and tail may overlap.',
      worldStepAttribution:
        'each profiled rAF worldStepCpuMs is divided by executedSteps and attributed to its covered exact simulation steps; the current diagnostics frame may be excluded by profile contract',
      preregisteredProductionCriterion: {
        impactNarrowphaseMedianP50RatioAtMost: 0.9,
        impactNarrowphaseMedianP95RatioAtMost: 0.9,
        improvingSeedsAtLeast: 4,
        benefitMustExceedMedianRepeatNoise: true,
      },
    },
  }
  const repositoryStateAtStart = readRepositoryState()
  let repositoryStateAtEnd: RepositoryState | null = null
  artifact.repository = { start: repositoryStateAtStart }
  let completed = false

  try {
    await runVariant(page, testInfo, issues, WARMUP_SEED, BASELINE, -2)
    await runVariant(page, testInfo, issues, WARMUP_SEED, CANDIDATE, -1)
    artifact.environment = await readBrowserMetadata(page)

    for (let seedIndex = 0; seedIndex < SEEDS.length; seedIndex++) {
      const seed = SEEDS[seedIndex]
      const order = variantOrder(seedIndex)
      const seedRuns: RunObservation[] = []
      for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
        const observation = await runVariant(
          page,
          testInfo,
          issues,
          seed,
          order[orderIndex],
          orderIndex,
        )
        seedRuns.push(observation)
        runs.push(observation)
      }
      pairs.push(compareSeed(seed, order, seedRuns))
    }

    const impactP50Ratios = pairs
      .map(
        ({ performance }) =>
          performance.impact.narrowphaseCpuMsPerStep.p50.candidateToBaselineRatio,
      )
      .filter((value): value is number => value !== null)
    const impactP95Ratios = pairs
      .map(
        ({ performance }) =>
          performance.impact.narrowphaseCpuMsPerStep.p95.candidateToBaselineRatio,
      )
      .filter((value): value is number => value !== null)
    const medianImpactP50Ratio = median(impactP50Ratios)
    const medianImpactP95Ratio = median(impactP95Ratios)
    const improvingSeedCount = pairs.filter(({ performance }) => {
      const p50 = performance.impact.narrowphaseCpuMsPerStep.p50.candidateToBaselineRatio
      const p95 = performance.impact.narrowphaseCpuMsPerStep.p95.candidateToBaselineRatio
      return p50 !== null && p95 !== null && p50 < 1 && p95 < 1
    }).length
    const impactP50RepeatNoise = pairs
      .flatMap(({ performance }) => {
        const evidence = performance.impact.narrowphaseCpuMsPerStep.p50
        return [evidence.baselineRepeatNoise, evidence.candidateRepeatNoise]
      })
      .filter((value): value is number => value !== null)
    const impactP95RepeatNoise = pairs
      .flatMap(({ performance }) => {
        const evidence = performance.impact.narrowphaseCpuMsPerStep.p95
        return [evidence.baselineRepeatNoise, evidence.candidateRepeatNoise]
      })
      .filter((value): value is number => value !== null)
    const medianImpactP50RepeatNoise = median(impactP50RepeatNoise)
    const medianImpactP95RepeatNoise = median(impactP95RepeatNoise)
    const impactP50BenefitExceedsNoise =
      medianImpactP50Ratio !== null &&
      medianImpactP50RepeatNoise !== null &&
      1 - medianImpactP50Ratio > medianImpactP50RepeatNoise
    const impactP95BenefitExceedsNoise =
      medianImpactP95Ratio !== null &&
      medianImpactP95RepeatNoise !== null &&
      1 - medianImpactP95Ratio > medianImpactP95RepeatNoise
    const preregisteredProductionCriterionMet =
      medianImpactP50Ratio !== null &&
      medianImpactP50Ratio <= 0.9 &&
      medianImpactP95Ratio !== null &&
      medianImpactP95Ratio <= 0.9 &&
      improvingSeedCount >= 4 &&
      impactP50BenefitExceedsNoise &&
      impactP95BenefitExceedsNoise

    artifact.summary = {
      measuredRolls: runs.length,
      strictEquivalentSeedCount: pairs.filter(({ strictEquivalent }) => strictEquivalent).length,
      medianImpactNarrowphaseP50Ratio: medianImpactP50Ratio,
      medianImpactNarrowphaseP95Ratio: medianImpactP95Ratio,
      impactNarrowphaseImprovingSeedCount: improvingSeedCount,
      medianImpactNarrowphaseP50RepeatNoise: medianImpactP50RepeatNoise,
      medianImpactNarrowphaseP95RepeatNoise: medianImpactP95RepeatNoise,
      impactP50BenefitExceedsNoise,
      impactP95BenefitExceedsNoise,
      preregisteredProductionCriterionMet,
      productionConclusion: preregisteredProductionCriterionMet
        ? 'eligible-for-production-review-not-auto-promoted'
        : 'do-not-advance',
    }
    expect(issues.pageErrors, 'uncaught page errors').toEqual([])
    expect(issues.consoleErrors, 'browser console errors').toEqual([])
    repositoryStateAtEnd = readRepositoryState()
    artifact.repository = {
      start: repositoryStateAtStart,
      end: repositoryStateAtEnd,
      unchangedDuringRun: sameRepositoryState(repositoryStateAtStart, repositoryStateAtEnd),
    }
    expect(
      sameRepositoryState(repositoryStateAtStart, repositoryStateAtEnd),
      'repository state changed during collision A/B run',
    ).toBe(true)
    completed = true
  } finally {
    repositoryStateAtEnd ??= readRepositoryState()
    artifact.repository = {
      start: repositoryStateAtStart,
      end: repositoryStateAtEnd,
      unchangedDuringRun: sameRepositoryState(repositoryStateAtStart, repositoryStateAtEnd),
    }
    artifact.result = {
      status: completed ? 'passed' : 'failed',
      runs: runs.map(artifactRunEvidence),
      pairs,
      issues,
    }
    const durableDirectory = resolve(process.cwd(), 'artifacts/collision-ab')
    await mkdir(durableDirectory, { recursive: true })
    await writeFile(
      resolve(durableDirectory, `${testInfo.project.name}-projected-aabb-v1.json`),
      `${JSON.stringify(artifact, null, 2)}\n`,
      'utf8',
    )
    await writeBenchArtifact(page, testInfo, artifact)
  }
})
