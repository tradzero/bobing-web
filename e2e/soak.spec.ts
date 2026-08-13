import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  BROWSER_BUDGETS,
  collectBrowserIssues,
  expectNoStaticFrames,
  waitForPostRender,
  waitForStaticQuiescence,
  type DiceRuntimeDiagnostics,
} from './helpers/diagnostics'

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
  rollSafety: DiceRuntimeDiagnostics['engine']['rollSafety']
  resources: ResourceSnapshot
}

function resourcesOf(diagnostics: DiceRuntimeDiagnostics, canvasCount: number): ResourceSnapshot {
  return {
    canvasCount,
    geometries: diagnostics.render.geometries,
    textures: diagnostics.render.textures,
    programs: diagnostics.render.programs,
  }
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
  test('固定 v1 seed 队列连续 20 轮无状态、调度或资源回退', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    const issues = collectBrowserIssues(page)
    const query = new URLSearchParams({
      nextSeeds: SOAK_SEED_PLAN.seeds.join(','),
      seedPlanVersion: String(SOAK_SEED_PLAN.version),
    })
    await page.goto(`/?${query}`)

    await expect(page.locator('canvas')).toHaveCount(1)
    await expect(page.getByRole('button', { name: '掷骰' })).toBeVisible()

    let previous = await waitForPostRender(page, { mode: 'idle', frameScheduled: false })
    previous = await waitForStaticQuiescence(page, previous)
    await expectNoStaticFrames(page, previous)
    const baselineResources = resourcesOf(previous, await page.locator('canvas').count())
    let settledProgramBaseline: number | null = null
    const startedAt = Date.now()
    const rounds: SoakRoundObservation[] = []

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
      expect(rolling.render.quality).toMatchObject({
        phase: 'rolling',
        rollingDprPreset: 'cap-1x-reduced-tier',
      })
      expect(rolling.render.quality?.effectivePixelRatio).toBeCloseTo(
        rolling.render.quality?.tier === 'reduced'
          ? BROWSER_BUDGETS.reducedTierRollingPixelRatio
          : (rolling.render.quality?.basePixelRatio ?? Number.NaN),
        8,
      )

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
        rollingDprPreset: 'cap-1x-reduced-tier',
      })
      expect(settled.render.quality?.effectivePixelRatio).toBeCloseTo(
        settled.render.quality?.basePixelRatio ?? Number.NaN,
        8,
      )
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
      expect(resources.textures, `round ${index + 1} texture leak`).toBe(baselineResources.textures)
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
        physicsSteps: settled.engine.physicsStepCount - previous.engine.physicsStepCount,
        rollSafety: { ...settled.engine.rollSafety },
        resources,
      })
      await expectNoStaticFrames(page, settled)

      expect(issues.pageErrors, `round ${index + 1} uncaught page errors`).toEqual([])
      expect(issues.consoleErrors, `round ${index + 1} browser console errors`).toEqual([])
      previous = settled
    }

    expect(SOAK_SEED_PLAN.seeds).toHaveLength(20)

    const settleReasons = Object.fromEntries(
      [...new Set(rounds.map(({ settleReason }) => settleReason))].map((reason) => [
        reason,
        rounds.filter(({ settleReason }) => settleReason === reason).length,
      ]),
    )
    const summary = {
      schemaVersion: 1,
      diagnosticsSchemaVersion: BROWSER_BUDGETS.diagnosticsSchemaVersion,
      project: testInfo.project.name,
      seedPlan: SOAK_SEED_PLAN,
      durationMs: Date.now() - startedAt,
      settleReasons,
      baselineResources,
      issues,
      rounds,
    }
    const summaryJson = `${JSON.stringify(summary, null, 2)}\n`
    const summaryPath = testInfo.outputPath('soak-summary.json')
    const durableArtifactDirectory = resolve(process.cwd(), 'artifacts/soak')
    const durableSummaryPath = resolve(durableArtifactDirectory, `${testInfo.project.name}.json`)
    await mkdir(durableArtifactDirectory, { recursive: true })
    await writeFile(summaryPath, summaryJson, 'utf8')
    await writeFile(durableSummaryPath, summaryJson, 'utf8')
    await testInfo.attach('soak-summary', {
      path: summaryPath,
      contentType: 'application/json',
    })
  })
})
