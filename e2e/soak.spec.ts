import { expect, test, type Page } from '@playwright/test'
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
  type DiceRuntimeDiagnostics,
} from './helpers/diagnostics'

const SOAK_ARTIFACT_SCHEMA_VERSION = 4

/**
 * v1 固定队列来自统一 Node runner：全部 natural-sleep、无倾斜、无保守边界/guard。
 * 算法或 seed 生成变化时必须新增版本，不能静默改写旧队列的复现语义。
 */
const SOAK_SEED_PLAN = {
  version: 1,
  throwAlgorithmVersion: 3,
  settleAlgorithmVersion: 4,
  seeds: [
    50_000, 51_000, 52_000, 53_000, 54_000, 55_000, 56_000, 57_000, 58_000, 59_000, 60_000, 61_000,
    63_000, 64_000, 65_000, 66_000, 67_000, 68_000, 70_000, 71_000,
  ],
} as const

/** 20 轮离散样本允许至多 1 次只读姿态窗口；其余必须为自然 sleep 或低速窗口。 */
const EXACT_CAP6_PATH_BUDGET = {
  version: 1,
  measuredRolls: SOAK_SEED_PLAN.seeds.length,
  clusterAssistMaxCount: 0,
  timeoutMaxCount: 0,
  timingOverloadMaxCount: 0,
  poseStableWindowMaxCount: 1,
  poseStableNominalRateLimit: 0.02,
  discreteSamplePolicy: 'allow-at-most-one-event-for-20-roll-sample',
  naturalOrStableMinCount: SOAK_SEED_PLAN.seeds.length - 1,
} as const

interface ResourceSnapshot {
  canvasCount: number
  geometries: number
  textures: number
  programs: number
}

interface SoakRoundObservation {
  round: number
  seed: number
  settleReason: NonNullable<DiceRuntimeDiagnostics['roll']['settleReason']>
  settleElapsed: number | null
  wallMs: number
  physicsSteps: number
  physicsTiming?: DiceRuntimeDiagnostics['engine']['physicsTiming']
  rollSafety: DiceRuntimeDiagnostics['engine']['rollSafety']
  resources: ResourceSnapshot
}

interface SoakScenario {
  id: 'production-default' | 'legacy-rollback'
  tag: '@soak-default' | '@soak-legacy-rollback'
  query: Readonly<Record<string, string>>
  durableArtifactSuffix: '-default' | '-legacy-rollback'
  expectedScheduler: {
    explicit: boolean
    variant: 'exact-cap6' | 'legacy-batched'
    kind: 'exact-accumulator' | 'legacy-batched'
    maxStepsPerFrame: 6 | null
  }
  usesExactTiming: boolean
}

const SOAK_SCENARIOS: readonly SoakScenario[] = [
  {
    id: 'production-default',
    tag: '@soak-default',
    query: {},
    durableArtifactSuffix: '-default',
    expectedScheduler: {
      explicit: false,
      variant: 'exact-cap6',
      kind: 'exact-accumulator',
      maxStepsPerFrame: 6,
    },
    usesExactTiming: true,
  },
  {
    id: 'legacy-rollback',
    tag: '@soak-legacy-rollback',
    query: {
      physicsSchedulerExperimentVersion: '1',
      physicsSchedulerVariant: 'legacy-batched',
    },
    durableArtifactSuffix: '-legacy-rollback',
    expectedScheduler: {
      explicit: true,
      variant: 'legacy-batched',
      kind: 'legacy-batched',
      maxStepsPerFrame: null,
    },
    usesExactTiming: false,
  },
] as const

function resourcesOf(diagnostics: DiceRuntimeDiagnostics, canvasCount: number): ResourceSnapshot {
  return {
    canvasCount,
    geometries: diagnostics.render.geometries,
    textures: diagnostics.render.textures,
    programs: diagnostics.render.programs,
  }
}

function countSettleReasons(rounds: readonly SoakRoundObservation[]): Record<string, number> {
  return Object.fromEntries(
    [...new Set(rounds.map(({ settleReason }) => settleReason))].map((reason) => [
      reason,
      rounds.filter(({ settleReason }) => settleReason === reason).length,
    ]),
  )
}

function settleReasonCount(counts: Readonly<Record<string, number>>, reason: string): number {
  return counts[reason] ?? 0
}

async function readCommittedRound(page: Page): Promise<{
  displayedRound: number
  historyRounds: number[]
  historyCount: number
  resultFaceCount: number
}> {
  return page.evaluate(() => {
    const displayedRoundText = document.querySelector('.round-display-value')?.textContent ?? ''
    const displayedRound = Number(displayedRoundText.match(/\d+/)?.[0] ?? Number.NaN)
    const historyRounds = [...document.querySelectorAll('.history-round')].map((element) =>
      Number(element.textContent?.match(/\d+/)?.[0] ?? Number.NaN),
    )

    return {
      displayedRound,
      historyRounds,
      historyCount: document.querySelectorAll('.history-item').length,
      resultFaceCount: document.querySelectorAll('.result-panel [aria-label^="骰子点数 "]').length,
    }
  })
}

test.describe('@soak 连续多轮真实浏览器 soak', () => {
  for (const scenario of SOAK_SCENARIOS) {
    test(`${scenario.tag} ${scenario.id} 固定 v1 seed 队列连续 20 轮无状态、调度或资源回退`, async ({
      page,
      browser,
    }, testInfo) => {
      test.setTimeout(180_000)
      const issues = collectBrowserIssues(page)
      const startedAt = Date.now()
      const rounds: SoakRoundObservation[] = []
      const repositoryStateAtStart = readRepositoryState()
      let repositoryStateAtEnd: RepositoryState | null = null
      let baselineResources: ResourceSnapshot | null = null
      let completed = false
      const artifact: Record<string, unknown> = {
        schemaVersion: SOAK_ARTIFACT_SCHEMA_VERSION,
        diagnosticsSchemaVersion: BROWSER_BUDGETS.diagnosticsSchemaVersion,
        project: testInfo.project.name,
        browserVersion: browser.version(),
        commit: repositoryStateAtStart.head,
        worktreeDirty: repositoryStateAtStart.worktreeDirty,
        schedulerScenario: scenario.id,
        seedPlan: SOAK_SEED_PLAN,
        exactPathBudget: scenario.usesExactTiming ? EXACT_CAP6_PATH_BUDGET : null,
        environment: null,
        repository: { start: repositoryStateAtStart },
      }

      try {
        const query = new URLSearchParams({
          nextSeeds: SOAK_SEED_PLAN.seeds.join(','),
          seedPlanVersion: String(SOAK_SEED_PLAN.version),
          ...scenario.query,
        })
        await page.goto(`/?${query}`)

        await expect(page.locator('canvas')).toHaveCount(1)
        await expect(page.getByRole('button', { name: '掷骰' })).toBeVisible()
        artifact.environment = await readBrowserMetadata(page)

        let previous = await waitForPostRender(page, { mode: 'idle', frameScheduled: false })
        previous = await waitForStaticQuiescence(page, previous)
        expect(previous.physicsSchedulerExperiment).toEqual({
          version: 1,
          ...scenario.expectedScheduler,
        })
        await expectNoStaticFrames(page, previous)
        baselineResources = resourcesOf(previous, await page.locator('canvas').count())
        let settledProgramBaseline: number | null = null

        for (let index = 0; index < SOAK_SEED_PLAN.seeds.length; index++) {
          const expectedSeed = SOAK_SEED_PLAN.seeds[index]
          const expectedRound = index + 2
          const expectedHistoryRounds = Array.from(
            { length: Math.min(index + 1, 5) },
            (_, historyIndex) => index + 1 - historyIndex,
          )
          const roundStartedAt = Date.now()

          await page.getByRole('button', { name: '掷骰' }).click()
          await expect(page.getByRole('button', { name: '骰子翻滚中' })).toBeDisabled()

          const rolling = await waitForPostRender(page, {
            mode: 'rolling',
            afterRevision: previous.revision,
            afterRenderCount: previous.engine.renderCount,
            frameScheduled: true,
          })
          expect(rolling.roll.seed, `round ${index + 1} seed queue`).toBe(expectedSeed)
          expectRenderBudgets(rolling, testInfo.project.name)
          expect(rolling.render.quality).toMatchObject({
            phase: 'rolling',
            rollingDprPreset: 'adaptive',
          })
          expect(rolling.render.pixelRatio).toBeLessThanOrEqual(
            rolling.render.quality!.basePixelRatio,
          )
          expect(rolling.render.pixelRatio).toBeGreaterThanOrEqual(0.75)
          expect(rolling.engine.rollingShadow).toMatchObject({
            version: 1,
            preset: 'every-frame',
          })
          expect(rolling.engine.rollingShadow.rollingRenderFrameCount).toBeGreaterThan(0)
          expect(rolling.engine.rollingShadow.rollingShadowUpdateRequestCount).toBe(
            rolling.engine.rollingShadow.rollingRenderFrameCount,
          )
          expect(
            rolling.engine.rollingShadow.maxConsecutiveRollingFramesWithoutShadowUpdateRequest,
          ).toBe(0)

          const settled = await waitForPostRender(page, {
            mode: 'settled',
            afterRevision: rolling.revision,
            afterRenderCount: rolling.engine.renderCount,
            frameScheduled: false,
            timeout: BROWSER_BUDGETS.settlementWallTimeoutMs,
          })
          await expect(page.locator('.result-panel')).toBeVisible()
          await expect(page.locator('.tilt-warning')).toHaveCount(0)
          expect(settled.roll.seed, `round ${index + 1} settled seed`).toBe(expectedSeed)
          expect(settled.render.quality).toMatchObject({
            phase: 'static',
            rollingDprPreset: 'adaptive',
          })
          expect(settled.render.quality?.effectivePixelRatio).toBeCloseTo(
            settled.render.quality?.basePixelRatio ?? Number.NaN,
            8,
          )
          expect(settled.engine.rollingShadow).toMatchObject({
            version: 1,
            preset: 'every-frame',
          })
          expect(settled.engine.rollingShadow.rollingRenderFrameCount).toBeGreaterThan(0)
          expect(settled.engine.rollingShadow.rollingShadowUpdateRequestCount).toBe(
            settled.engine.rollingShadow.rollingRenderFrameCount,
          )
          expect(
            settled.engine.rollingShadow.maxConsecutiveRollingFramesWithoutShadowUpdateRequest,
          ).toBe(0)
          expect(settled.roll.throwAlgorithmVersion).toBe(SOAK_SEED_PLAN.throwAlgorithmVersion)
          expect(settled.roll.settleAlgorithmVersion).toBe(SOAK_SEED_PLAN.settleAlgorithmVersion)
          // Browser rAF 的 wall-clock 分帧会让同一固定步轨迹在 natural/低速/姿态窗口间竞争；
          // 三者均是不含人工 assist/timeout 的正式结算路径。
          expect(settled.roll.settleReason).toMatch(
            /^(natural-sleep|stable-window|pose-stable-window)$/,
          )
          expect(settled.roll.settleReason).not.toBe('cluster-assist')
          expect(settled.roll.settleReason).not.toBe('timeout')
          expect(settled.engine.rollSafety.nonFiniteBodyStateDetected).toBe(false)
          expect(settled.engine.rollSafety.escapeGuardInterventionCount).toBe(0)
          expect(settled.engine.rollSafety.wallCenterCrossings).toBe(0)
          expect(settled.engine.rollSafety.conservativeBoundaryCrossings).toBe(0)
          expect(settled.engine.rollSafety.maxContactPenetration).toBeLessThanOrEqual(0.1)
          expect(
            settled.engine.rollSafety.maxRadius,
            `round ${index + 1} crossed the physical wall inner face`,
          ).toBeLessThan(settled.engine.rollSafety.containmentRadius)
          expect(settled.physicsSchedulerExperiment).toEqual({
            version: 1,
            ...scenario.expectedScheduler,
          })

          const physicsSteps = settled.engine.physicsStepCount - previous.engine.physicsStepCount
          if (scenario.usesExactTiming) {
            const timing = settled.engine.physicsTiming
            expect(timing.preset).toBe('exact-cap6')
            expect(timing.simulationStep).toBeGreaterThan(0)
            expect(timing.totalExecutedSteps).toBe(timing.simulationStep)
            expect(timing.simulationTime).toBeCloseTo(
              timing.totalExecutedSteps * (timing.fixedStepMs / 1000),
              9,
            )
            expect(timing.totalPausedWallDeltaMs).toBe(0)
            expect(timing.totalRawWallDeltaMs).toBeCloseTo(
              timing.totalAcceptedWallDeltaMs + timing.totalDiscardedWallDeltaMs,
              8,
            )
            expect(timing.terminalAbandoned).toMatchObject({ reason: 'settled' })
            expect(timing.queuedMs).toBe(timing.terminalAbandoned!.queuedMs)
            expect(timing.queuedWholeSteps).toBe(timing.terminalAbandoned!.queuedWholeSteps)
            expect(timing.interpolationAlpha).toBe(timing.terminalAbandoned!.interpolationAlpha)
            expect(timing.totalAcceptedWallDeltaMs).toBeCloseTo(
              timing.totalExecutedSteps * timing.fixedStepMs + timing.terminalAbandoned!.queuedMs,
              7,
            )
            expect(timing.overload.active).toBe(false)
            expect(
              physicsSteps,
              `round ${index + 1} cumulative Engine step delta must equal the reset per-roll timing counter`,
            ).toBe(timing.totalExecutedSteps)
          }

          const committed = await readCommittedRound(page)
          expect(committed.displayedRound, `round ${index + 1} committed exactly once`).toBe(
            expectedRound,
          )
          expect(committed.historyCount).toBe(Math.min(index + 1, 5))
          expect(committed.historyRounds).toEqual(expectedHistoryRounds)
          expect(committed.resultFaceCount).toBe(6)

          const resources = resourcesOf(settled, await page.locator('canvas').count())
          expect(resources.canvasCount, `round ${index + 1} canvas ownership`).toBe(1)
          expect(resources.geometries, `round ${index + 1} geometry leak`).toBe(
            baselineResources.geometries,
          )
          expect(resources.textures, `round ${index + 1} texture leak`).toBe(
            baselineResources.textures,
          )
          // 首次 rolling 允许额外编译 shader；warm-up 后不能逐轮增长。
          expect(resources.programs, `round ${index + 1} program leak`).toBeLessThanOrEqual(
            BROWSER_BUDGETS.maxPrograms[
              testInfo.project.name.startsWith('mobile') ? 'mobile' : 'desktop'
            ].settled,
          )
          if (settledProgramBaseline === null) settledProgramBaseline = resources.programs
          else {
            expect(resources.programs, `round ${index + 1} program count grew after warm-up`).toBe(
              settledProgramBaseline,
            )
          }
          rounds.push({
            round: index + 1,
            seed: expectedSeed,
            settleReason: settled.roll.settleReason!,
            settleElapsed: settled.roll.settleElapsed,
            wallMs: Date.now() - roundStartedAt,
            physicsSteps,
            physicsTiming: scenario.usesExactTiming
              ? {
                  ...settled.engine.physicsTiming,
                  overload: { ...settled.engine.physicsTiming.overload },
                  terminalAbandoned: settled.engine.physicsTiming.terminalAbandoned
                    ? { ...settled.engine.physicsTiming.terminalAbandoned }
                    : null,
                }
              : undefined,
            rollSafety: { ...settled.engine.rollSafety },
            resources,
          })
          await expectNoStaticFrames(page, settled)

          expect(issues.pageErrors, `round ${index + 1} uncaught page errors`).toEqual([])
          expect(issues.consoleErrors, `round ${index + 1} browser console errors`).toEqual([])
          previous = settled
        }

        expect(SOAK_SEED_PLAN.seeds).toHaveLength(20)
        expect(rounds).toHaveLength(SOAK_SEED_PLAN.seeds.length)

        const settleReasons = countSettleReasons(rounds)
        if (scenario.usesExactTiming) {
          expect(settleReasonCount(settleReasons, 'cluster-assist')).toBeLessThanOrEqual(
            EXACT_CAP6_PATH_BUDGET.clusterAssistMaxCount,
          )
          expect(settleReasonCount(settleReasons, 'timeout')).toBeLessThanOrEqual(
            EXACT_CAP6_PATH_BUDGET.timeoutMaxCount,
          )
          expect(settleReasonCount(settleReasons, 'timing-overload')).toBeLessThanOrEqual(
            EXACT_CAP6_PATH_BUDGET.timingOverloadMaxCount,
          )
          expect(settleReasonCount(settleReasons, 'pose-stable-window')).toBeLessThanOrEqual(
            EXACT_CAP6_PATH_BUDGET.poseStableWindowMaxCount,
          )
          expect(
            settleReasonCount(settleReasons, 'natural-sleep') +
              settleReasonCount(settleReasons, 'stable-window'),
          ).toBeGreaterThanOrEqual(EXACT_CAP6_PATH_BUDGET.naturalOrStableMinCount)
          expect(
            settleReasonCount(settleReasons, 'natural-sleep') +
              settleReasonCount(settleReasons, 'stable-window') +
              settleReasonCount(settleReasons, 'pose-stable-window'),
            'exact-cap6 每轮必须由 natural/stable/pose-stable 三条无介入路径之一结算',
          ).toBe(rounds.length)
        }
        artifact.summary = {
          durationMs: Date.now() - startedAt,
          measuredRolls: rounds.length,
          settleReasons,
          baselineResources,
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
          'repository state changed during browser soak run',
        ).toBe(true)
        completed = true
      } finally {
        repositoryStateAtEnd ??= readRepositoryState()
        const settleReasons = countSettleReasons(rounds)
        artifact.repository = {
          start: repositoryStateAtStart,
          end: repositoryStateAtEnd,
          unchangedDuringRun: sameRepositoryState(repositoryStateAtStart, repositoryStateAtEnd),
        }
        artifact.result = {
          status: completed ? 'passed' : 'failed',
          durationMs: Date.now() - startedAt,
          measuredRolls: rounds.length,
          settleReasons,
          baselineResources,
          issues,
          rounds,
        }

        // finally 总是覆盖 durable 路径，失败运行不会遗留上一次的 passed 证据。
        const summaryJson = `${JSON.stringify(artifact, null, 2)}\n`
        const summaryPath = testInfo.outputPath(
          `soak-summary${scenario.durableArtifactSuffix}.json`,
        )
        const durableArtifactDirectory = resolve(process.cwd(), 'artifacts/soak')
        const durableSummaryPath = resolve(
          durableArtifactDirectory,
          `${testInfo.project.name}${scenario.durableArtifactSuffix}.json`,
        )
        await mkdir(durableArtifactDirectory, { recursive: true })
        await writeFile(summaryPath, summaryJson, 'utf8')
        await writeFile(durableSummaryPath, summaryJson, 'utf8')
        await testInfo.attach(`soak-summary${scenario.durableArtifactSuffix}`, {
          path: summaryPath,
          contentType: 'application/json',
        })
      }
    })
  }
})
