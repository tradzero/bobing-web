import { expect, test } from '@playwright/test'
import {
  BROWSER_BUDGETS,
  E2E_NEXT_SEED,
  collectBrowserIssues,
  expectNoStaticFrames,
  expectRenderBudgets,
  measureRaf,
  readBrowserMetadata,
  readDiagnostics,
  waitForPostRender,
  waitForSettlementUi,
  waitForStaticQuiescence,
  writeBenchArtifact,
  type DiceRuntimeDiagnostics,
  type RafStats,
} from './helpers/diagnostics'

test('WebGL 结构预算与调度 bench', async ({ page, browser }, testInfo) => {
  const issues = collectBrowserIssues(page)
  const artifact: Record<string, unknown> = {
    schemaVersion: 1,
    project: testInfo.project.name,
    budgets: BROWSER_BUDGETS,
    browserVersion: browser.version(),
  }
  let idle: DiceRuntimeDiagnostics | null = null
  let rolling: DiceRuntimeDiagnostics | null = null
  let settled: DiceRuntimeDiagnostics | null = null
  let raf: RafStats | null = null
  let settleWallMs: number | null = null
  let completed = false

  try {
    await page.goto(`/?nextSeed=${E2E_NEXT_SEED}`)
    await expect(page.getByRole('button', { name: '掷骰' })).toBeVisible()
    artifact.environment = await readBrowserMetadata(page)

    idle = await waitForPostRender(page, { mode: 'idle', frameScheduled: false })
    idle = await waitForStaticQuiescence(page, idle)
    expectRenderBudgets(idle, testInfo.project.name)
    await expectNoStaticFrames(page, idle)

    const settleStartedAt = performance.now()
    await page.getByRole('button', { name: '掷骰' }).click()
    rolling = await waitForPostRender(page, {
      mode: 'rolling',
      afterRevision: idle.revision,
      afterRenderCount: idle.engine.renderCount,
      frameScheduled: true,
    })
    expectRenderBudgets(rolling, testInfo.project.name)
    expect(rolling.roll.seed).toBe(E2E_NEXT_SEED)

    raf = await measureRaf(page)
    const afterRaf = await readDiagnostics(page)
    expect(afterRaf, 'rolling diagnostics must remain available during rAF sampling').not.toBeNull()
    expect(afterRaf!.engine.renderCount).toBeGreaterThan(rolling.engine.renderCount)
    expect(afterRaf!.engine.physicsStepCount).toBeGreaterThan(rolling.engine.physicsStepCount)

    await waitForSettlementUi(page)
    settled = await waitForPostRender(page, {
      mode: 'settled',
      afterRevision: rolling.revision,
      afterRenderCount: rolling.engine.renderCount,
      frameScheduled: false,
      timeout: BROWSER_BUDGETS.settlementWallTimeoutMs,
    })
    settleWallMs = performance.now() - settleStartedAt
    expectRenderBudgets(settled, testInfo.project.name)
    expect(settleWallMs).toBeLessThanOrEqual(BROWSER_BUDGETS.settlementWallTimeoutMs)
    expect(settled.roll.seed).toBe(E2E_NEXT_SEED)
    expect(settled.roll.placementPath).toMatch(/^(rejection|constructive|fallback)$/)
    expect(settled.roll.settleReason).not.toBeNull()
    await expectNoStaticFrames(page, settled)

    expect(issues.pageErrors, 'uncaught page errors').toEqual([])
    expect(issues.consoleErrors, 'browser console errors').toEqual([])
    completed = true
  } finally {
    const lastDiagnostics = await readDiagnostics(page).catch(() => null)
    artifact.result = {
      status: completed ? 'passed' : 'failed',
      seed: E2E_NEXT_SEED,
      idle,
      rolling,
      settled,
      lastDiagnostics,
      raf,
      settleWallMs,
      issues,
    }
    await writeBenchArtifact(page, testInfo, artifact)
  }
})
