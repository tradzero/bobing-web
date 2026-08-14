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

const RENDER_AB_SCHEMA_VERSION = 2
const RENDER_EXPERIMENT_VERSION = 1
const PROFILE_VERSION = 1
const SEEDS = [50_000, 55_000, 60_000, 65_000, 70_000] as const
const WARMUP_SEED = 42

type RenderVariant = DiceRuntimeDiagnostics['renderExperiment']['variant']

interface ComparisonDefinition {
  id: 'rolling-dpr' | 'shadow-upper-bound'
  candidate: Extract<RenderVariant, 'rolling-dpr-1x' | 'shadow-frozen'>
}

interface RunObservation {
  seed: number
  variant: RenderVariant
  orderIndex: number
  tilted: boolean
  faces: number[]
  prize: string
  carry: string | null
  settleWallMs: number
  idle: DiceRuntimeDiagnostics
  rolling: DiceRuntimeDiagnostics
  settled: DiceRuntimeDiagnostics
  contextLossCount: number
}

interface SeedComparison {
  seed: number
  order: RenderVariant[]
  baselineStable: boolean
  candidateStable: boolean
  schedulerSensitive: boolean
  behaviorEquivalent: boolean | null
  rafP95Ratio: number | null
  settleWallRatio: number
  baselineRepeatNoise: number | null
  candidateRepeatNoise: number | null
}

const COMPARISONS: ComparisonDefinition[] = [
  { id: 'rolling-dpr', candidate: 'rolling-dpr-1x' },
  { id: 'shadow-upper-bound', candidate: 'shadow-frozen' },
]

function variantOrder(seedIndex: number, candidate: RenderVariant): RenderVariant[] {
  return seedIndex % 2 === 0
    ? ['baseline', candidate, candidate, 'baseline']
    : [candidate, 'baseline', 'baseline', candidate]
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
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

function expectProfile(diagnostics: DiceRuntimeDiagnostics): void {
  const profile = diagnostics.engine.performanceProfile
  expect(profile, 'explicit render A/B must publish the rolling CPU profile').toBeDefined()
  expect(profile).toMatchObject({
    version: PROFILE_VERSION,
    sampleKind: 'rolling-cpu',
    rendererTimingKind: 'cpu-submit',
  })
  expect(profile!.retainedFrameCount).toBeGreaterThan(0)
  expect(profile!.metrics.cannonStepnumberDelta.max).not.toBeNull()
  expect(profile!.metrics.cannonStepnumberDelta.max!).toBeLessThanOrEqual(6)
}

function expectProductionPhysicsScheduler(diagnostics: DiceRuntimeDiagnostics): void {
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
    overload: { active: false, highWaterMs: 250 },
    suspended: false,
  })
}

function expectSettledExactTiming(diagnostics: DiceRuntimeDiagnostics): void {
  expectProductionPhysicsScheduler(diagnostics)
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

function expectRollingStructure(diagnostics: DiceRuntimeDiagnostics, projectName: string): void {
  const { render } = diagnostics
  const expectedWidth = Math.floor(render.cssWidth * render.pixelRatio)
  const expectedHeight = Math.floor(render.cssHeight * render.pixelRatio)
  expect(Math.abs(render.drawingBufferWidth - expectedWidth)).toBeLessThanOrEqual(1)
  expect(Math.abs(render.drawingBufferHeight - expectedHeight)).toBeLessThanOrEqual(1)
  expect(render.mainPassCalls, `[${projectName}] rolling main pass calls`).toBe(
    BROWSER_BUDGETS.mainPassCalls,
  )
  expect(render.mainPassTriangles, `[${projectName}] rolling triangles`).toBe(
    BROWSER_BUDGETS.mainPassTriangles,
  )
  expect(render.geometries).toBe(BROWSER_BUDGETS.geometries)
  expect(render.textures).toBeLessThanOrEqual(BROWSER_BUDGETS.maxTextures)
}

function expectExperimentState(
  diagnostics: DiceRuntimeDiagnostics,
  variant: RenderVariant,
  expectedPhase: 'static' | 'rolling',
): void {
  expect(diagnostics.renderExperiment).toMatchObject({
    version: RENDER_EXPERIMENT_VERSION,
    explicit: true,
    variant,
  })
  const quality = diagnostics.render.quality
  expect(quality, 'render quality diagnostics must be available').not.toBeNull()
  expect(quality!.phase).toBe(expectedPhase)
  expect(quality!.effectivePixelRatio).toBeCloseTo(diagnostics.render.pixelRatio, 8)

  if (variant === 'rolling-dpr-1x') {
    expect(quality!.rollingDprPreset).toBe('cap-1x')
    expect(diagnostics.engine.rollingShadow.preset).toBe('every-frame')
    expect(quality!.effectivePixelRatio).toBe(
      expectedPhase === 'rolling' ? 1 : quality!.basePixelRatio,
    )
  } else if (variant === 'shadow-frozen') {
    expect(quality!.rollingDprPreset).toBe('baseline')
    expect(quality!.effectivePixelRatio).toBe(quality!.basePixelRatio)
    expect(diagnostics.engine.rollingShadow.preset).toBe('frozen-after-first')
  } else {
    expect(quality!.rollingDprPreset).toBe('baseline')
    expect(quality!.effectivePixelRatio).toBe(quality!.basePixelRatio)
    expect(diagnostics.engine.rollingShadow.preset).toBe('every-frame')
  }
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

function expectShadowSchedule(observation: RunObservation): void {
  const shadow = observation.settled.engine.rollingShadow
  expect(shadow.rollingRenderFrameCount).toBeGreaterThan(0)
  if (observation.variant === 'shadow-frozen') {
    expect(shadow.rollingShadowUpdateRequestCount).toBe(1)
    expect(shadow.maxConsecutiveRollingFramesWithoutShadowUpdateRequest).toBe(
      shadow.rollingRenderFrameCount - 1,
    )
  } else {
    expect(shadow.rollingShadowUpdateRequestCount).toBe(shadow.rollingRenderFrameCount)
    expect(shadow.maxConsecutiveRollingFramesWithoutShadowUpdateRequest).toBe(0)
  }
}

async function runVariant(
  page: Page,
  testInfo: TestInfo,
  issues: BrowserIssues,
  seed: number,
  variant: RenderVariant,
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
    renderExperimentVersion: String(RENDER_EXPERIMENT_VERSION),
    renderVariant: variant,
  })
  await page.goto(`/?${query}`)
  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '掷骰' })).toBeVisible()

  let idle = await waitForPostRender(page, { mode: 'idle', frameScheduled: false })
  idle = await waitForStaticQuiescence(page, idle)
  expectProductionPhysicsScheduler(idle)
  expect(idle.engine.physicsTiming).toMatchObject({
    simulationStep: null,
    simulationTime: null,
    totalExecutedSteps: 0,
    queuedMs: 0,
    terminalAbandoned: null,
  })
  expectExperimentState(idle, variant, 'static')
  expectRenderBudgets(idle, testInfo.project.name)
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
  expectProductionPhysicsScheduler(rolling)
  expectExperimentState(rolling, variant, 'rolling')
  expectRollingStructure(rolling, testInfo.project.name)
  expect(rolling.roll.seed).toBe(seed)
  if (variant === 'rolling-dpr-1x') {
    expect(rolling.render.drawingBufferPixels).toBeLessThan(idle.render.drawingBufferPixels)
  }

  const settlement = page.locator('.result-panel, .tilt-warning')
  await expect(settlement).toBeVisible({ timeout: BROWSER_BUDGETS.settlementWallTimeoutMs })
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
  expectExperimentState(settled, variant, 'static')
  expectSettledExactTiming(settled)
  expectRenderBudgets(settled, testInfo.project.name)
  expectRollSafety(settled)
  expectProfile(settled)

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
    settleWallMs,
    idle,
    rolling,
    settled,
    contextLossCount: await page.evaluate(
      () =>
        (window as typeof window & { __diceWebglContextLossCount?: number })
          .__diceWebglContextLossCount ?? 0,
    ),
  }

  expectShadowSchedule(observation)
  expect(observation.contextLossCount).toBe(0)
  expect(issues.pageErrors.slice(issueOffsets.pageErrors), 'new page errors').toEqual([])
  expect(issues.consoleErrors.slice(issueOffsets.consoleErrors), 'new console errors').toEqual([])
  await expectNoStaticFrames(page, settled)
  return observation
}

function compareSeed(
  seed: number,
  order: RenderVariant[],
  observations: readonly RunObservation[],
  candidate: RenderVariant,
): SeedComparison {
  const baseline = observations.filter(({ variant }) => variant === 'baseline')
  const candidateRuns = observations.filter(({ variant }) => variant === candidate)
  const baselineSignatures = baseline.map(resultSignature)
  const candidateSignatures = candidateRuns.map(resultSignature)
  const baselineStable = new Set(baselineSignatures).size === 1
  const candidateStable = new Set(candidateSignatures).size === 1
  const behaviorEquivalent = baselineStable
    ? candidateStable && baselineSignatures[0] === candidateSignatures[0]
    : null
  const profileP95 = (run: RunObservation) =>
    run.settled.engine.performanceProfile?.metrics.rafRawDeltaMs.p95 ?? null
  const baselineP95 = baseline.map(profileP95).filter((value): value is number => value !== null)
  const candidateP95 = candidateRuns
    .map(profileP95)
    .filter((value): value is number => value !== null)
  const baselineMedian = median(baselineP95)
  const candidateMedian = median(candidateP95)
  const baselineWall = median(baseline.map(({ settleWallMs }) => settleWallMs))!
  const candidateWall = median(candidateRuns.map(({ settleWallMs }) => settleWallMs))!

  return {
    seed,
    order,
    baselineStable,
    candidateStable,
    schedulerSensitive: !baselineStable,
    behaviorEquivalent,
    rafP95Ratio:
      baselineMedian === null || baselineMedian === 0 || candidateMedian === null
        ? null
        : candidateMedian / baselineMedian,
    settleWallRatio: candidateWall / baselineWall,
    baselineRepeatNoise: relativeRepeatNoise(baselineP95),
    candidateRepeatNoise: relativeRepeatNoise(candidateP95),
  }
}

for (const comparison of COMPARISONS) {
  test(`@render-ab ${comparison.id}: baseline vs ${comparison.candidate}`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(600_000)
    const issues = collectBrowserIssues(page)
    const runs: RunObservation[] = []
    const pairs: SeedComparison[] = []
    const artifact: Record<string, unknown> = {
      schemaVersion: RENDER_AB_SCHEMA_VERSION,
      comparison,
      project: testInfo.project.name,
      browserVersion: browser.version(),
      seeds: SEEDS,
      executionPattern: 'ABBA/BAAB alternating by seed',
    }
    const repositoryStateAtStart = readRepositoryState()
    let repositoryStateAtEnd: RepositoryState | null = null
    artifact.repository = { start: repositoryStateAtStart }
    let completed = false

    try {
      // 两侧各预热一轮，shader/纹理编译结果不进入配对统计。
      await runVariant(page, testInfo, issues, WARMUP_SEED, 'baseline', -2)
      await runVariant(page, testInfo, issues, WARMUP_SEED, comparison.candidate, -1)
      artifact.environment = await readBrowserMetadata(page)

      for (let seedIndex = 0; seedIndex < SEEDS.length; seedIndex++) {
        const seed = SEEDS[seedIndex]
        const order = variantOrder(seedIndex, comparison.candidate)
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
        expect(new Set(throwPlanSignatures).size, `seed ${seed} throw plan drift`).toBe(1)

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
        expect(
          new Set(initialStateSignatures).size,
          `seed ${seed} initial body pose/velocity drift`,
        ).toBe(1)
        pairs.push(compareSeed(seed, order, seedRuns, comparison.candidate))
      }

      const conclusivePairs = pairs.filter(({ behaviorEquivalent }) => behaviorEquivalent !== null)
      const behaviorViolations = conclusivePairs.filter(
        ({ behaviorEquivalent }) => behaviorEquivalent === false,
      )
      const p95Ratios = pairs
        .map(({ rafP95Ratio }) => rafP95Ratio)
        .filter((value): value is number => value !== null)
      const repeatNoise = pairs
        .flatMap(({ baselineRepeatNoise, candidateRepeatNoise }) => [
          baselineRepeatNoise,
          candidateRepeatNoise,
        ])
        .filter((value): value is number => value !== null)
      const medianP95Ratio = median(p95Ratios)
      const medianRepeatNoise = median(repeatNoise)
      artifact.summary = {
        measuredRolls: runs.length,
        schedulerSensitiveSeeds: pairs
          .filter(({ schedulerSensitive }) => schedulerSensitive)
          .map(({ seed }) => seed),
        conclusiveBehaviorSeeds: conclusivePairs.length,
        behaviorViolationSeeds: behaviorViolations.map(({ seed }) => seed),
        medianRafP95Ratio: medianP95Ratio,
        improvingSeedCount: p95Ratios.filter((ratio) => ratio < 1).length,
        medianRepeatNoise,
        provisionalPerformanceThresholdMet:
          medianP95Ratio !== null &&
          medianP95Ratio <= 0.9 &&
          p95Ratios.filter((ratio) => ratio < 1).length >= Math.ceil(p95Ratios.length * 0.6) &&
          (medianRepeatNoise === null || 1 - medianP95Ratio > medianRepeatNoise),
      }
      expect(behaviorViolations, 'render candidate changed a stable baseline result').toEqual([])
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
        'repository state changed during render A/B run',
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
      const durableDirectory = resolve(process.cwd(), 'artifacts/render-ab')
      await mkdir(durableDirectory, { recursive: true })
      await writeFile(
        resolve(durableDirectory, `${testInfo.project.name}-${comparison.id}.json`),
        `${JSON.stringify(artifact, null, 2)}\n`,
        'utf8',
      )
      await writeBenchArtifact(page, testInfo, artifact)
    }
  })
}
