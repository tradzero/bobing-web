import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
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
  type DiceRuntimeDiagnostics,
} from './helpers/diagnostics'

const PHYSICS_SCHEDULER_BROWSER_AB_SCHEMA_VERSION = 2
const PHYSICS_SCHEDULER_EXPERIMENT_VERSION = 1
const PROFILE_VERSION = 1
const SEEDS = [50_000, 55_000, 60_000, 65_000, 70_000] as const
const WARMUP_SEED = 42
const MIN_BEHAVIOR_COMPARABLE_SEEDS = 4

type SchedulerVariant = Extract<
  DiceRuntimeDiagnostics['physicsSchedulerExperiment']['variant'],
  'legacy-batched' | 'exact-cap6'
>

interface RunObservation {
  seed: number
  variant: SchedulerVariant
  orderIndex: number
  tilted: boolean
  faces: number[]
  prize: string
  carry: string | null
  settleReason: DiceRuntimeDiagnostics['roll']['settleReason']
  settleWallMs: number
  idle: DiceRuntimeDiagnostics
  rolling: DiceRuntimeDiagnostics
  settled: DiceRuntimeDiagnostics
  contextLossCount: number
  safetyHardGatePassed: true
}

interface SeedComparison {
  seed: number
  order: SchedulerVariant[]
  throwPlanEquivalent: boolean
  initialStateEquivalent: boolean
  legacyResultStable: boolean
  exactResultStable: boolean
  behaviorSensitive: boolean
  legacyFinalStateStable: boolean
  exactFinalStateStable: boolean
  trajectoryEquivalent: boolean | null
  trajectorySensitive: boolean
  settlementPathSensitive: boolean
  resultEquivalent: boolean | null
  behaviorComparable: boolean
  allRunsSafetyHardGatePassed: boolean
  performanceComparable: boolean
  performanceExclusionReasons: string[]
  behaviorConclusion:
    | 'result-equivalent-with-stable-repeats'
    | 'different-stable-results'
    | 'inconclusive-result-unstable'
    | 'invalid-input-drift'
  trajectoryConclusion:
    | 'trajectory-equivalent-with-stable-repeats'
    | 'different-stable-final-state'
    | 'inconclusive-final-state-unstable'
  rafP95Ratio: number | null
  settleWallRatio: number
  legacyRepeatNoise: number | null
  exactRepeatNoise: number | null
  rawSafetyExtremaObservation: {
    legacy: RawSafetyExtrema[]
    exact: RawSafetyExtrema[]
    candidateMinusBaselineMedian: RawSafetyExtrema
  }
  executionEvidence: {
    legacy: RunExecutionEvidence[]
    exact: RunExecutionEvidence[]
  }
}

interface RawSafetyExtrema {
  maxRadius: number
  maxContactPenetration: number
}

interface RunExecutionEvidence {
  physicsStepCount: number
  accumulatorExecutedSteps: number
  profileTotalFrameCount: number
  profileRetainedFrameCount: number
  profiledCannonDeltaSampleCount: number
  cannonStepsPerProfiledFrame: {
    p50: number | null
    p95: number | null
    max: number | null
  }
}

function variantOrder(seedIndex: number): SchedulerVariant[] {
  return seedIndex % 2 === 0
    ? ['legacy-batched', 'exact-cap6', 'exact-cap6', 'legacy-batched']
    : ['exact-cap6', 'legacy-batched', 'legacy-batched', 'exact-cap6']
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function relativeRepeatNoise(values: readonly number[]): number | null {
  if (values.length !== 2) return null
  const center = median(values)
  if (center === null || center === 0) return null
  return Math.abs(values[0] - values[1]) / center
}

function resultSignature(observation: RunObservation): string {
  return JSON.stringify({
    tilted: observation.tilted,
    faces: observation.faces,
    prize: observation.prize,
    carry: observation.carry,
  })
}

function canonicalStateSignature(
  state: NonNullable<DiceRuntimeDiagnostics['roll']['finalState']>,
): string {
  // hash 锁定位级 Float64，完整 arrays 同时保留可审计的逐 body 证据。
  return JSON.stringify({ hash: state.hash, bodies: state.bodies })
}

function rawSafetyExtrema(observation: RunObservation): RawSafetyExtrema {
  const { rollSafety } = observation.settled.engine
  return {
    maxRadius: rollSafety.maxRadius,
    maxContactPenetration: rollSafety.maxContactPenetration,
  }
}

function expectFinalCanonicalState(diagnostics: DiceRuntimeDiagnostics, context: string): void {
  const finalState = diagnostics.roll.finalState
  expect(finalState, `${context} final canonical state must be published`).not.toBeNull()
  if (!finalState) throw new Error(`${context} final canonical state is missing`)
  expect(finalState).toMatchObject({
    version: 1,
    floatEncoding: 'ieee754-float64-be',
    hashAlgorithm: 'fnv1a64',
    hash: expect.stringMatching(/^[0-9a-f]{16}$/),
  })
  expect(finalState.bodies, `${context} final canonical body count`).toHaveLength(6)
  for (const [bodyIndex, body] of finalState.bodies.entries()) {
    const fields = [
      ['position', body.position, 3],
      ['quaternion', body.quaternion, 4],
      ['velocity', body.velocity, 3],
      ['angularVelocity', body.angularVelocity, 3],
    ] as const
    for (const [field, values, length] of fields) {
      expect(values, `${context} body ${bodyIndex} ${field} tuple length`).toHaveLength(length)
      expect(
        values.every(Number.isFinite),
        `${context} body ${bodyIndex} ${field} must be finite`,
      ).toBe(true)
    }
  }
}

function expectProfile(diagnostics: DiceRuntimeDiagnostics, variant: SchedulerVariant): void {
  const profile = diagnostics.engine.performanceProfile
  expect(profile, 'scheduler A/B must publish the rolling CPU profile').toBeDefined()
  expect(profile).toMatchObject({
    version: PROFILE_VERSION,
    sampleKind: 'rolling-cpu',
    rendererTimingKind: 'cpu-submit',
  })
  expect(profile!.retainedFrameCount).toBeGreaterThan(0)
  const maxSteps = profile!.metrics.cannonStepnumberDelta.max
  expect(maxSteps, 'rolling profile must observe Cannon steps').not.toBeNull()
  expect(maxSteps!).toBeGreaterThan(0)
  expect(maxSteps!).toBeLessThanOrEqual(variant === 'exact-cap6' ? 6 : 8)
}

function expectRenderContract(
  diagnostics: DiceRuntimeDiagnostics,
  phase: 'static' | 'rolling',
): void {
  expect(diagnostics.renderExperiment).toEqual({
    version: 1,
    explicit: false,
    variant: 'rolling-dpr-reduced-tier',
    rollingDprPreset: 'cap-1x-reduced-tier',
    rollingShadowPreset: 'every-frame',
  })
  expect(diagnostics.render.quality).toMatchObject({
    phase,
    rollingDprPreset: 'cap-1x-reduced-tier',
  })
  expect(diagnostics.engine.rollingShadow.preset).toBe('every-frame')
}

function runExecutionEvidence(observation: RunObservation): RunExecutionEvidence {
  const profile = observation.settled.engine.performanceProfile!
  const cannonDelta = profile.metrics.cannonStepnumberDelta
  return {
    physicsStepCount: observation.settled.engine.physicsStepCount,
    accumulatorExecutedSteps: observation.settled.engine.physicsTiming.totalExecutedSteps,
    profileTotalFrameCount: profile.totalFrameCount,
    profileRetainedFrameCount: profile.retainedFrameCount,
    profiledCannonDeltaSampleCount: cannonDelta.count,
    cannonStepsPerProfiledFrame: {
      p50: cannonDelta.p50,
      p95: cannonDelta.p95,
      max: cannonDelta.max,
    },
  }
}

function expectSchedulerTiming(
  diagnostics: DiceRuntimeDiagnostics,
  variant: SchedulerVariant,
): void {
  const experiment = diagnostics.physicsSchedulerExperiment
  const timing = diagnostics.engine.physicsTiming
  expect(experiment).toEqual({
    version: PHYSICS_SCHEDULER_EXPERIMENT_VERSION,
    explicit: true,
    variant,
    kind: variant === 'exact-cap6' ? 'exact-accumulator' : 'legacy-batched',
    maxStepsPerFrame: variant === 'exact-cap6' ? 6 : null,
  })
  expect(timing).toMatchObject({
    version: PHYSICS_SCHEDULER_EXPERIMENT_VERSION,
    preset: variant,
    kind: variant === 'exact-cap6' ? 'exact-accumulator' : 'legacy-batched',
    maxStepsPerFrame: variant === 'exact-cap6' ? 6 : null,
    overload: { active: false },
    suspended: false,
  })

  if (variant === 'legacy-batched') {
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
    return
  }

  if (diagnostics.engine.mode === 'idle') {
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
    return
  }

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

async function runVariant(
  page: Page,
  testInfo: TestInfo,
  issues: BrowserIssues,
  seed: number,
  variant: SchedulerVariant,
  orderIndex: number,
): Promise<RunObservation> {
  const issueOffsets = {
    consoleErrors: issues.consoleErrors.length,
    pageErrors: issues.pageErrors.length,
  }
  const query = new URLSearchParams({
    nextSeed: String(seed),
    perfProfile: '1',
    perfProfileVersion: String(PROFILE_VERSION),
    physicsSchedulerExperimentVersion: String(PHYSICS_SCHEDULER_EXPERIMENT_VERSION),
    physicsSchedulerVariant: variant,
  })
  await page.goto(`/?${query}`)
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '掷骰' })).toBeVisible()

  let idle = await waitForPostRender(page, { mode: 'idle', frameScheduled: false })
  idle = await waitForStaticQuiescence(page, idle)
  expectSchedulerTiming(idle, variant)
  expectRenderContract(idle, 'static')
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
  expect(rolling.physicsSchedulerExperiment.variant).toBe(variant)
  expectRenderContract(rolling, 'rolling')
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
  expectSchedulerTiming(settled, variant)
  expectRollSafety(settled)
  expectFinalCanonicalState(settled, `${variant} seed ${seed}`)
  expectRenderContract(settled, 'static')
  expectRenderBudgets(settled, testInfo.project.name)
  expectProfile(settled, variant)
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
    settleWallMs,
    idle,
    rolling,
    settled,
    contextLossCount: await page.evaluate(
      () =>
        (window as typeof window & { __diceWebglContextLossCount?: number })
          .__diceWebglContextLossCount ?? 0,
    ),
    safetyHardGatePassed: true,
  }

  expect(observation.contextLossCount).toBe(0)
  expect(issues.pageErrors.slice(issueOffsets.pageErrors), 'new page errors').toEqual([])
  expect(issues.consoleErrors.slice(issueOffsets.consoleErrors), 'new console errors').toEqual([])
  await expectNoStaticFrames(page, settled)
  return observation
}

function compareSeed(
  seed: number,
  order: SchedulerVariant[],
  observations: readonly RunObservation[],
  inputEquivalence: {
    throwPlanEquivalent: boolean
    initialStateEquivalent: boolean
  },
): SeedComparison {
  const legacy = observations.filter(({ variant }) => variant === 'legacy-batched')
  const exact = observations.filter(({ variant }) => variant === 'exact-cap6')
  const legacySignatures = legacy.map(resultSignature)
  const exactSignatures = exact.map(resultSignature)
  const legacyResultStable = new Set(legacySignatures).size === 1
  const exactResultStable = new Set(exactSignatures).size === 1
  const resultEquivalent =
    legacyResultStable && exactResultStable ? legacySignatures[0] === exactSignatures[0] : null

  const finalStateSignature = (run: RunObservation) =>
    canonicalStateSignature(run.settled.roll.finalState!)
  const legacyFinalStateSignatures = legacy.map(finalStateSignature)
  const exactFinalStateSignatures = exact.map(finalStateSignature)
  const legacyFinalStateStable = new Set(legacyFinalStateSignatures).size === 1
  const exactFinalStateStable = new Set(exactFinalStateSignatures).size === 1
  const trajectoryEquivalent =
    legacyFinalStateStable && exactFinalStateStable
      ? legacyFinalStateSignatures[0] === exactFinalStateSignatures[0]
      : null

  const profileP95 = (run: RunObservation) =>
    run.settled.engine.performanceProfile?.metrics.rafRawDeltaMs.p95 ?? null
  const legacyP95 = legacy.map(profileP95).filter((value): value is number => value !== null)
  const exactP95 = exact.map(profileP95).filter((value): value is number => value !== null)
  const legacyMedian = median(legacyP95)
  const exactMedian = median(exactP95)
  const legacyWall = median(legacy.map(({ settleWallMs }) => settleWallMs))!
  const exactWall = median(exact.map(({ settleWallMs }) => settleWallMs))!
  const settlementReasons = (runs: readonly RunObservation[]) =>
    new Set(runs.map(({ settleReason }) => settleReason))
  const settlementPathSensitive =
    settlementReasons(legacy).size !== 1 ||
    settlementReasons(exact).size !== 1 ||
    legacy[0].settleReason !== exact[0].settleReason
  const behaviorComparable =
    inputEquivalence.throwPlanEquivalent &&
    inputEquivalence.initialStateEquivalent &&
    legacyResultStable &&
    exactResultStable &&
    resultEquivalent === true
  const allRunsSafetyHardGatePassed = observations.every(
    ({ safetyHardGatePassed }) => safetyHardGatePassed,
  )
  const performanceExclusionReasons = [
    ...(!inputEquivalence.throwPlanEquivalent ? ['throw-plan-drift'] : []),
    ...(!inputEquivalence.initialStateEquivalent ? ['initial-state-drift'] : []),
    ...(!legacyResultStable ? ['legacy-result-unstable'] : []),
    ...(!exactResultStable ? ['exact-result-unstable'] : []),
    ...(resultEquivalent === false ? ['stable-result-mismatch'] : []),
    ...(!allRunsSafetyHardGatePassed ? ['per-run-safety-hard-gate-failed'] : []),
    ...(settlementPathSensitive ? ['settlement-path-sensitive'] : []),
  ]
  const behaviorConclusion =
    !inputEquivalence.throwPlanEquivalent || !inputEquivalence.initialStateEquivalent
      ? 'invalid-input-drift'
      : !legacyResultStable || !exactResultStable
        ? 'inconclusive-result-unstable'
        : resultEquivalent
          ? 'result-equivalent-with-stable-repeats'
          : 'different-stable-results'
  const trajectoryConclusion =
    !legacyFinalStateStable || !exactFinalStateStable
      ? 'inconclusive-final-state-unstable'
      : trajectoryEquivalent
        ? 'trajectory-equivalent-with-stable-repeats'
        : 'different-stable-final-state'
  const legacyRawExtrema = legacy.map(rawSafetyExtrema)
  const exactRawExtrema = exact.map(rawSafetyExtrema)
  const medianExtrema = (values: readonly RawSafetyExtrema[]): RawSafetyExtrema => ({
    maxRadius: median(values.map(({ maxRadius }) => maxRadius))!,
    maxContactPenetration: median(
      values.map(({ maxContactPenetration }) => maxContactPenetration),
    )!,
  })
  const legacyMedianExtrema = medianExtrema(legacyRawExtrema)
  const exactMedianExtrema = medianExtrema(exactRawExtrema)

  return {
    seed,
    order,
    ...inputEquivalence,
    legacyResultStable,
    exactResultStable,
    behaviorSensitive: !behaviorComparable,
    legacyFinalStateStable,
    exactFinalStateStable,
    trajectoryEquivalent,
    trajectorySensitive: trajectoryEquivalent !== true,
    settlementPathSensitive,
    resultEquivalent,
    behaviorComparable,
    allRunsSafetyHardGatePassed,
    performanceComparable:
      behaviorComparable && allRunsSafetyHardGatePassed && !settlementPathSensitive,
    performanceExclusionReasons,
    behaviorConclusion,
    trajectoryConclusion,
    rafP95Ratio:
      legacyMedian === null || legacyMedian === 0 || exactMedian === null
        ? null
        : exactMedian / legacyMedian,
    settleWallRatio: exactWall / legacyWall,
    legacyRepeatNoise: relativeRepeatNoise(legacyP95),
    exactRepeatNoise: relativeRepeatNoise(exactP95),
    rawSafetyExtremaObservation: {
      legacy: legacyRawExtrema,
      exact: exactRawExtrema,
      candidateMinusBaselineMedian: {
        maxRadius: exactMedianExtrema.maxRadius - legacyMedianExtrema.maxRadius,
        maxContactPenetration:
          exactMedianExtrema.maxContactPenetration - legacyMedianExtrema.maxContactPenetration,
      },
    },
    executionEvidence: {
      legacy: legacy.map(runExecutionEvidence),
      exact: exact.map(runExecutionEvidence),
    },
  }
}

test('@physics-scheduler-ab legacy-batched vs exact-cap6', async ({ page, browser }, testInfo) => {
  test.setTimeout(600_000)
  const issues = collectBrowserIssues(page)
  const runs: RunObservation[] = []
  const pairs: SeedComparison[] = []
  const artifact: Record<string, unknown> = {
    schemaVersion: PHYSICS_SCHEDULER_BROWSER_AB_SCHEMA_VERSION,
    comparison: { baseline: 'legacy-batched', candidate: 'exact-cap6' },
    project: testInfo.project.name,
    browserVersion: browser.version(),
    seeds: SEEDS,
    executionPattern: 'ABBA/BAAB alternating by seed',
    cohortPolicy: {
      seedCount: SEEDS.length,
      minimumBehaviorComparableSeeds: MIN_BEHAVIOR_COMPARABLE_SEEDS,
      behaviorComparableRequires:
        'identical throw plan and initial canonical state; both repeats UI-result-stable; equivalent faces/prize/carry/tilt across schedulers',
      performanceComparableAdditionallyRequires:
        'all per-run hard safety gates pass and the settlement path matches across all four runs; final trajectory equivalence is reported separately and is not required',
    },
    performancePolicy: 'observational-only-no-cross-machine-threshold',
    equivalencePolicy: {
      inputHardGate: 'identical versioned throw plan and complete initial canonical body state',
      behavior:
        'stable repeated UI result on each side and equivalent faces/prize/carry/tilt across schedulers',
      behaviorInconclusive:
        'within-side UI result instability is excluded from the behavior and performance cohorts',
      trajectory:
        'complete final canonical body hash and arrays must be stable within each side and equal across schedulers to claim trajectory equivalence',
      rawSafetyExtrema:
        'maxRadius and maxContactPenetration deltas are observational only; every run retains the unchanged hard safety gates',
    },
  }
  const repositoryStateAtStart = readRepositoryState()
  let repositoryStateAtEnd: RepositoryState | null = null
  artifact.repository = { start: repositoryStateAtStart }
  let completed = false

  try {
    // 两侧各预热一轮，shader/纹理编译及首轮 JIT 不进入配对统计。
    await runVariant(page, testInfo, issues, WARMUP_SEED, 'legacy-batched', -2)
    await runVariant(page, testInfo, issues, WARMUP_SEED, 'exact-cap6', -1)
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

      const throwPlanSignatures = seedRuns.map(({ settled }) =>
        JSON.stringify({
          seed: settled.roll.seed,
          throwAlgorithmVersion: settled.roll.throwAlgorithmVersion,
          placementAlgorithm: settled.roll.placementAlgorithm,
          attempts: settled.roll.placementAttempts,
          restarts: settled.roll.placementRestarts,
          groupAttempts: settled.roll.placementGroupAttempts,
          randomPlanVersion: settled.roll.randomPlanVersion,
          path: settled.roll.placementPath,
          fallback: settled.roll.fallbackLayout,
        }),
      )
      const throwPlanEquivalent = new Set(throwPlanSignatures).size === 1
      expect(throwPlanEquivalent, `seed ${seed} throw plan drift`).toBe(true)

      const initialStateSignatures = seedRuns.map(({ settled }) => {
        const initialState = settled.roll.initialState
        expect(initialState, `seed ${seed} initial body state must be published`).not.toBeNull()
        expect(initialState).toMatchObject({
          version: 1,
          floatEncoding: 'ieee754-float64-be',
          hashAlgorithm: 'fnv1a64',
          hash: expect.stringMatching(/^[0-9a-f]{16}$/),
        })
        expect(initialState!.bodies).toHaveLength(6)
        return JSON.stringify(initialState)
      })
      const initialStateEquivalent = new Set(initialStateSignatures).size === 1
      expect(initialStateEquivalent, `seed ${seed} initial state drift`).toBe(true)

      const pair = compareSeed(seed, order, seedRuns, {
        throwPlanEquivalent,
        initialStateEquivalent,
      })
      pairs.push(pair)
    }

    const stableBehaviorViolations = pairs
      .filter(({ resultEquivalent }) => resultEquivalent === false)
      .map(({ seed }) => seed)
    const behaviorComparablePairs = pairs.filter(({ behaviorComparable }) => behaviorComparable)
    const performanceComparablePairs = pairs.filter(
      ({ performanceComparable }) => performanceComparable,
    )
    const performanceExcludedSeeds = pairs
      .filter(({ performanceComparable }) => !performanceComparable)
      .map(({ seed, performanceExclusionReasons }) => ({
        seed,
        reasons: performanceExclusionReasons,
      }))
    const rafP95Ratios = performanceComparablePairs
      .map(({ rafP95Ratio }) => rafP95Ratio)
      .filter((value): value is number => value !== null)
    const settleWallRatios = performanceComparablePairs.map(
      ({ settleWallRatio }) => settleWallRatio,
    )
    const repeatNoise = performanceComparablePairs
      .flatMap(({ legacyRepeatNoise, exactRepeatNoise }) => [legacyRepeatNoise, exactRepeatNoise])
      .filter((value): value is number => value !== null)
    artifact.summary = {
      measuredRolls: runs.length,
      behaviorComparableSeedCount: behaviorComparablePairs.length,
      behaviorComparableSeeds: behaviorComparablePairs.map(({ seed }) => seed),
      minimumBehaviorComparableSeeds: MIN_BEHAVIOR_COMPARABLE_SEEDS,
      behaviorCohortThresholdMet: behaviorComparablePairs.length >= MIN_BEHAVIOR_COMPARABLE_SEEDS,
      performanceComparableSeedCount: performanceComparablePairs.length,
      performanceComparableSeeds: performanceComparablePairs.map(({ seed }) => seed),
      performanceExcludedSeeds,
      behaviorSensitiveSeeds: pairs
        .filter(({ behaviorSensitive }) => behaviorSensitive)
        .map(({ seed }) => seed),
      trajectoryEquivalentSeeds: pairs
        .filter(({ trajectoryEquivalent }) => trajectoryEquivalent === true)
        .map(({ seed }) => seed),
      trajectoryEquivalentSeedCount: pairs.filter(
        ({ trajectoryEquivalent }) => trajectoryEquivalent === true,
      ).length,
      trajectoryStableMismatchSeeds: pairs
        .filter(({ trajectoryEquivalent }) => trajectoryEquivalent === false)
        .map(({ seed }) => seed),
      trajectoryInconclusiveSeeds: pairs
        .filter(({ trajectoryEquivalent }) => trajectoryEquivalent === null)
        .map(({ seed }) => seed),
      trajectorySensitiveSeeds: pairs
        .filter(({ trajectorySensitive }) => trajectorySensitive)
        .map(({ seed }) => seed),
      settlementPathSensitiveSeeds: pairs
        .filter(({ settlementPathSensitive }) => settlementPathSensitive)
        .map(({ seed }) => seed),
      conclusiveResultSeeds: pairs.filter(({ resultEquivalent }) => resultEquivalent !== null)
        .length,
      stableBehaviorViolationSeeds: stableBehaviorViolations,
      medianRafP95Ratio: median(rafP95Ratios),
      exactRafImprovingSeedCount: rafP95Ratios.filter((ratio) => ratio < 1).length,
      medianSettlementWallRatio: median(settleWallRatios),
      exactSettlementWallImprovingSeedCount: settleWallRatios.filter((ratio) => ratio < 1).length,
      medianRepeatNoise: median(repeatNoise),
      performanceConclusion: 'observation-only',
    }
    expect(stableBehaviorViolations, 'stable scheduler results differ').toEqual([])
    expect(
      behaviorComparablePairs.length,
      `physics scheduler A/B requires at least ${MIN_BEHAVIOR_COMPARABLE_SEEDS}/${SEEDS.length} behavior-comparable seeds`,
    ).toBeGreaterThanOrEqual(MIN_BEHAVIOR_COMPARABLE_SEEDS)
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
      'repository state changed during physics scheduler A/B run',
    ).toBe(true)
    completed = true
  } finally {
    repositoryStateAtEnd ??= readRepositoryState()
    artifact.repository = {
      start: repositoryStateAtStart,
      end: repositoryStateAtEnd,
      unchangedDuringRun: sameRepositoryState(repositoryStateAtStart, repositoryStateAtEnd),
    }
    artifact.result = { status: completed ? 'passed' : 'failed', pairs, runs, issues }
    const durableDirectory = resolve(process.cwd(), 'artifacts/physics-scheduler-ab')
    await mkdir(durableDirectory, { recursive: true })
    await writeFile(
      resolve(durableDirectory, `${testInfo.project.name}-legacy-vs-exact-cap6-v2.json`),
      `${JSON.stringify(artifact, null, 2)}\n`,
      'utf8',
    )
    await writeBenchArtifact(page, testInfo, artifact)
  }
})
