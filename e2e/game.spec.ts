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
  expect(idle.engine.performanceProfile).toBeUndefined()
  expect(idle.renderExperiment).toMatchObject({
    explicit: false,
    variant: 'rolling-dpr-reduced-tier',
    rollingDprPreset: 'cap-1x-reduced-tier',
    rollingShadowPreset: 'every-frame',
  })
  expect(idle.render.quality?.phase).toBe('static')
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
  expect(rolling.render.quality?.phase).toBe('rolling')
  const expectedRollingPixelRatio =
    rolling.render.quality?.tier === 'reduced'
      ? BROWSER_BUDGETS.reducedTierRollingPixelRatio
      : idle.render.pixelRatio
  expect(rolling.render.pixelRatio).toBeCloseTo(expectedRollingPixelRatio, 8)
  if (rolling.render.quality?.tier === 'reduced') {
    expect(rolling.render.drawingBufferPixels).toBeLessThan(idle.render.drawingBufferPixels)
  } else {
    expect(rolling.render.drawingBufferPixels).toBe(idle.render.drawingBufferPixels)
  }
  expect(rolling.engine.rollingShadow.preset).toBe('every-frame')

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
  expect(settled.engine.performanceProfile).toBeUndefined()
  expect(settled.render.quality?.phase).toBe('static')
  expect(settled.render.pixelRatio).toBeCloseTo(idle.render.pixelRatio, 8)
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

test('timeout 不提交结果，并可在同一轮恢复投掷', async ({ page }) => {
  const issues = collectBrowserIssues(page)
  const query = new URLSearchParams({
    nextSeeds: [42, 50_000].join(','),
    seedPlanVersion: '1',
    forceNextSettlement: 'timeout',
    settlementOverrideVersion: '1',
  })
  await page.goto(`/?${query}`)

  let previous = await waitForPostRender(page, { mode: 'idle', frameScheduled: false })
  previous = await waitForStaticQuiescence(page, previous)

  await page.getByRole('button', { name: '掷骰' }).click()
  const firstRolling = await waitForPostRender(page, {
    mode: 'rolling',
    afterRevision: previous.revision,
    afterRenderCount: previous.engine.renderCount,
    frameScheduled: true,
  })
  expect(firstRolling.roll.seed).toBe(42)

  const errorSettled = await waitForPostRender(page, {
    mode: 'settled',
    afterRevision: firstRolling.revision,
    afterRenderCount: firstRolling.engine.renderCount,
    frameScheduled: false,
  })
  await expect(page.getByRole('alert')).toContainText('本轮未结算')
  await expect(page.getByRole('alert')).toContainText('未读取点数，也未计入记录')
  await expect(page.locator('.result-panel')).toHaveCount(0)
  await expect(page.locator('.history-item')).toHaveCount(0)
  await expect(page.locator('.round-display-value')).toHaveText('第 1 轮')
  await expect(page.getByRole('button', { name: '掷骰', exact: true })).toBeDisabled()
  expect(errorSettled.roll.seed).toBe(42)
  expect(errorSettled.roll.settleReason).toBe('timeout')
  await expectNoStaticFrames(page, errorSettled)

  await page.getByRole('button', { name: '重新掷骰' }).click()
  const recoveryRolling = await waitForPostRender(page, {
    mode: 'rolling',
    afterRevision: errorSettled.revision,
    afterRenderCount: errorSettled.engine.renderCount,
    frameScheduled: true,
  })
  expect(recoveryRolling.roll.seed).toBe(50_000)

  await waitForSettlementUi(page)
  const recovered = await waitForPostRender(page, {
    mode: 'settled',
    afterRevision: recoveryRolling.revision,
    afterRenderCount: recoveryRolling.engine.renderCount,
    frameScheduled: false,
  })
  expect(recovered.roll.seed).toBe(50_000)
  expect(recovered.roll.settleReason).not.toBe('timeout')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.locator('.result-panel [aria-label^="骰子点数 "]')).toHaveCount(6)
  await expect(page.locator('.history-item')).toHaveCount(1)
  await expect(page.locator('.round-display-value')).toHaveText('第 2 轮')
  await expectNoStaticFrames(page, recovered)

  expect(issues.pageErrors, 'uncaught page errors').toEqual([])
  expect(issues.consoleErrors, 'browser console errors').toEqual([])
})

test('exact-cap6 使用逐固定步真值完成正常结算并满足时间守恒', async ({ page }) => {
  const issues = collectBrowserIssues(page)
  const query = new URLSearchParams({
    nextSeed: String(E2E_NEXT_SEED),
    physicsSchedulerExperimentVersion: '1',
    physicsSchedulerVariant: 'exact-cap6',
  })
  await page.goto(`/?${query}`)

  let idle = await waitForPostRender(page, { mode: 'idle', frameScheduled: false })
  idle = await waitForStaticQuiescence(page, idle)
  expect(idle.physicsSchedulerExperiment).toEqual({
    version: 1,
    explicit: true,
    variant: 'exact-cap6',
    kind: 'exact-accumulator',
    maxStepsPerFrame: 6,
  })
  expect(idle.engine.physicsTiming).toMatchObject({
    preset: 'exact-cap6',
    kind: 'exact-accumulator',
    simulationStep: null,
    totalExecutedSteps: 0,
    overload: { active: false, highWaterMs: 250 },
  })

  await page.getByRole('button', { name: '掷骰' }).click()
  const rolling = await waitForPostRender(page, {
    mode: 'rolling',
    afterRevision: idle.revision,
    afterRenderCount: idle.engine.renderCount,
    frameScheduled: true,
  })
  expect(rolling.roll.seed).toBe(E2E_NEXT_SEED)
  expect(rolling.engine.physicsTiming.preset).toBe('exact-cap6')

  await waitForSettlementUi(page)
  const settled = await waitForPostRender(page, {
    mode: 'settled',
    afterRevision: rolling.revision,
    afterRenderCount: rolling.engine.renderCount,
    frameScheduled: false,
    timeout: BROWSER_BUDGETS.settlementWallTimeoutMs,
  })
  const timing = settled.engine.physicsTiming
  expect(settled.roll.settleReason).toMatch(/^(natural-sleep|stable-window|pose-stable-window)$/)
  expect(timing.simulationStep).toBeGreaterThan(0)
  expect(timing.totalExecutedSteps).toBe(timing.simulationStep)
  expect(timing.simulationTime).toBeCloseTo(
    timing.totalExecutedSteps * (timing.fixedStepMs / 1000),
    9,
  )
  expect(timing.totalRawWallDeltaMs).toBeCloseTo(
    timing.totalAcceptedWallDeltaMs + timing.totalDiscardedWallDeltaMs,
    8,
  )
  expect(timing.terminalAbandoned).toMatchObject({ reason: 'settled' })
  expect(timing.totalAcceptedWallDeltaMs).toBeCloseTo(
    timing.totalExecutedSteps * timing.fixedStepMs + timing.terminalAbandoned!.queuedMs,
    7,
  )
  expect(timing.overload.active).toBe(false)
  expect(settled.engine.rollSafety).toMatchObject({
    conservativeBoundaryCrossings: 0,
    wallCenterCrossings: 0,
    escapeGuardInterventionCount: 0,
    nonFiniteBodyStateDetected: false,
  })
  await expect(page.locator('.result-panel [aria-label^="骰子点数 "]')).toHaveCount(6)
  await expectNoStaticFrames(page, settled)

  expect(issues.pageErrors, 'uncaught page errors').toEqual([])
  expect(issues.consoleErrors, 'browser console errors').toEqual([])
})

test('exact-cap4 六个 100ms 慢帧进入显式 overload，绝不提交结果', async ({ page }) => {
  const issues = collectBrowserIssues(page)
  await page.clock.install({ time: new Date('2026-08-13T00:00:00Z') })
  const query = new URLSearchParams({
    nextSeed: String(E2E_NEXT_SEED),
    physicsSchedulerExperimentVersion: '1',
    physicsSchedulerVariant: 'exact-cap4',
  })
  await page.goto(`/?${query}`)

  let idle = await waitForPostRender(page, { mode: 'idle', frameScheduled: false })
  idle = await waitForStaticQuiescence(page, idle)
  const pauseTime = await page.evaluate(() => Date.now())
  // Date.now() 只有整数毫秒，而 Clock 内部可能已前进到同毫秒的小数部分；向前留出
  // 明确余量再 pause，避免把舍入后的整数误判为回拨。
  await page.clock.pauseAt(pauseTime + 1_000)

  await page.getByRole('button', { name: '掷骰' }).click()
  await expect(page.getByRole('button', { name: '骰子翻滚中' })).toBeDisabled()
  for (let frame = 0; frame < 6; frame++) await page.clock.fastForward(100)

  const errored = await waitForPostRender(page, {
    mode: 'error',
    afterRevision: idle.revision,
    afterRenderCount: idle.engine.renderCount,
    frameScheduled: false,
  })
  expect(errored.physicsSchedulerExperiment).toEqual({
    version: 1,
    explicit: true,
    variant: 'exact-cap4',
    kind: 'exact-accumulator',
    maxStepsPerFrame: 4,
  })
  expect(errored.roll.settleReason).toBe('timing-overload')
  expect(errored.engine.physicsStepCount).toBe(20)
  expect(errored.engine.physicsTiming).toMatchObject({
    preset: 'exact-cap4',
    simulationStep: 20,
    simulationTime: 20 / 60,
    totalRawWallDeltaMs: 600,
    totalAcceptedWallDeltaMs: 600,
    totalPausedWallDeltaMs: 0,
    totalDiscardedWallDeltaMs: 0,
    totalExecutedSteps: 20,
    queuedMs: expect.closeTo(800 / 3, 7),
    queuedWholeSteps: 16,
    overload: { active: true, highWaterMs: 250 },
    terminalAbandoned: {
      reason: 'timing-overload',
      queuedMs: expect.closeTo(800 / 3, 7),
      queuedWholeSteps: 16,
    },
  })
  await expect(page.getByRole('alert')).toContainText('本轮未结算')
  await expect(page.getByRole('alert')).toContainText('物理模拟积压超过安全上限')
  await expect(page.getByRole('alert')).toContainText('已模拟 0.33 秒 / 20 步')
  await expect(page.locator('.result-panel')).toHaveCount(0)
  await expect(page.locator('.history-item')).toHaveCount(0)
  await expect(page.locator('.round-display-value')).toHaveText('第 1 轮')
  await expectNoStaticFrames(page, errored)

  await page.getByRole('alert').getByRole('button', { name: '重置', exact: true }).click()
  await page.clock.fastForward(20)
  const resetIdle = await waitForPostRender(page, {
    mode: 'idle',
    afterRevision: errored.revision,
    afterRenderCount: errored.engine.renderCount,
    frameScheduled: false,
  })
  expect(resetIdle.engine.physicsTiming.totalExecutedSteps).toBe(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.locator('.round-display-value')).toHaveText('第 1 轮')

  expect(issues.pageErrors, 'uncaught page errors').toEqual([])
  expect(issues.consoleErrors, 'browser console errors').toEqual([])
})
