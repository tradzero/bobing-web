import { expect, test } from '@playwright/test'
import {
  BROWSER_BUDGETS,
  E2E_NEXT_SEED,
  collectBrowserIssues,
  expectNoStaticFrames,
  waitForPostRender,
  waitForSettlementUi,
  waitForStaticQuiescence,
} from './helpers/diagnostics'

test('desktop/mobile 完整投掷流程与静态调度契约', async ({ page }, testInfo) => {
  const issues = collectBrowserIssues(page)
  await page.goto(`/?nextSeed=${E2E_NEXT_SEED}`)

  await expect(page.locator('canvas')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '掷骰' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重置游戏' })).toBeVisible()

  let idle = await waitForPostRender(page, {
    mode: 'idle',
    frameScheduled: false,
  })
  idle = await waitForStaticQuiescence(page, idle)
  expect(idle.engine.physicsStepCount).toBe(0)
  await expectNoStaticFrames(page, idle)

  if (testInfo.project.name.startsWith('mobile')) {
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!
      const button = document.querySelector('.btn-throw')!
      const canvasRect = canvas.getBoundingClientRect()
      const buttonRect = button.getBoundingClientRect()
      return {
        innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        canvas: {
          left: canvasRect.left,
          right: canvasRect.right,
          height: canvasRect.height,
        },
        button: { left: buttonRect.left, right: buttonRect.right },
      }
    })
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth + 1)
    expect(layout.canvas.left).toBeGreaterThanOrEqual(-1)
    expect(layout.canvas.right).toBeLessThanOrEqual(layout.innerWidth + 1)
    expect(layout.canvas.height).toBeGreaterThanOrEqual(519)
    expect(layout.canvas.height).toBeLessThanOrEqual(761)
    expect(layout.button.left).toBeGreaterThanOrEqual(-1)
    expect(layout.button.right).toBeLessThanOrEqual(layout.innerWidth + 1)
  }

  await page.getByRole('button', { name: '掷骰' }).click()
  await expect(page.getByRole('button', { name: '骰子翻滚中' })).toBeDisabled()

  const rolling = await waitForPostRender(page, {
    mode: 'rolling',
    afterRevision: idle.revision,
    afterRenderCount: idle.engine.renderCount,
    frameScheduled: true,
  })
  expect(rolling.roll.seed).toBe(E2E_NEXT_SEED)
  expect(rolling.roll.placementPath).toMatch(/^(rejection|constructive|fallback)$/)
  expect(rolling.engine.physicsStepCount).toBeGreaterThanOrEqual(idle.engine.physicsStepCount)

  await waitForSettlementUi(page)
  await expect(page.locator('.result-panel [aria-label^="骰子点数 "]')).toHaveCount(6)
  const faceLabels = await page
    .locator('.result-panel [aria-label^="骰子点数 "]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')))
  for (const label of faceLabels) expect(label).toMatch(/^骰子点数 [1-6]$/)
  await expect(page.locator('.round-display-value')).toHaveText('第 2 轮')
  await expect(page.locator('.history-item')).toHaveCount(1)

  const settled = await waitForPostRender(page, {
    mode: 'settled',
    afterRevision: rolling.revision,
    afterRenderCount: rolling.engine.renderCount,
    frameScheduled: false,
    timeout: BROWSER_BUDGETS.settlementWallTimeoutMs,
  })
  expect(settled.roll.seed).toBe(E2E_NEXT_SEED)
  expect(settled.roll.settleReason).not.toBeNull()
  await expectNoStaticFrames(page, settled)

  await page.getByRole('button', { name: '重置游戏' }).click()
  const resetIdle = await waitForPostRender(page, {
    mode: 'idle',
    afterRevision: settled.revision,
    afterRenderCount: settled.engine.renderCount,
    frameScheduled: false,
  })
  await expectNoStaticFrames(page, resetIdle)
  await expect(page.locator('.round-display-value')).toHaveText('第 1 轮')
  await expect(page.locator('.result-panel')).toHaveCount(0)
  await expect(page.locator('.history-item')).toHaveCount(0)
  await expect(page.locator('canvas')).toHaveCount(1)

  expect(issues.pageErrors, 'uncaught page errors').toEqual([])
  expect(issues.consoleErrors, 'browser console errors').toEqual([])
})
