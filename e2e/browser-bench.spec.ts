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
    await page.goto(`/?nextSeed=${E2E_NEXT_SEED}&perfProfile=1&perfProfileVersion=1`)
    await expect(page.getByRole('button', { name: '掷骰' })).toBeVisible()
    artifact.environment = await readBrowserMetadata(page)

    idle = await waitForPostRender(page, { mode: 'idle', frameScheduled: false })
    idle = await waitForStaticQuiescence(page, idle)
    expect(idle.physicsSchedulerExperiment).toEqual({
      version: 1,
      explicit: false,
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
    expect(idle.renderExperiment).toMatchObject({
      explicit: false,
      variant: 'rolling-dpr-reduced-tier',
      rollingDprPreset: 'cap-1x-reduced-tier',
      rollingShadowPreset: 'every-frame',
    })
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
    expect(rolling.physicsSchedulerExperiment).toMatchObject({
      explicit: false,
      variant: 'exact-cap6',
    })
    expectRenderBudgets(rolling, testInfo.project.name)
    expect(rolling.roll.seed).toBe(E2E_NEXT_SEED)
    if (rolling.render.quality?.tier === 'reduced') {
      expect(rolling.render.drawingBufferPixels).toBeLessThan(idle.render.drawingBufferPixels)
    } else {
      expect(rolling.render.drawingBufferPixels).toBe(idle.render.drawingBufferPixels)
    }

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
    expect(settled.render.pixelRatio).toBeCloseTo(idle.render.pixelRatio, 8)
    expect(settled.render.quality?.basePixelRatio).toBeCloseTo(
      idle.render.quality?.basePixelRatio ?? Number.NaN,
      8,
    )
    expect(settleWallMs).toBeLessThanOrEqual(BROWSER_BUDGETS.settlementWallTimeoutMs)
    expect(settled.roll.seed).toBe(E2E_NEXT_SEED)
    expect(settled.roll.placementPath).toMatch(/^(rejection|constructive|fallback)$/)
    expect(settled.roll.settleReason).not.toBeNull()
    expect(settled.physicsSchedulerExperiment).toEqual({
      version: 1,
      explicit: false,
      variant: 'exact-cap6',
      kind: 'exact-accumulator',
      maxStepsPerFrame: 6,
    })
    const timing = settled.engine.physicsTiming
    expect(timing).toMatchObject({
      preset: 'exact-cap6',
      kind: 'exact-accumulator',
      overload: { active: false, highWaterMs: 250 },
      terminalAbandoned: { reason: 'settled' },
    })
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
    expect(timing.totalPausedWallDeltaMs).toBe(0)
    expect(timing.totalAcceptedWallDeltaMs).toBeCloseTo(
      timing.totalExecutedSteps * timing.fixedStepMs + timing.terminalAbandoned!.queuedMs,
      7,
    )
    expect(settled.engine.rollingShadow).toMatchObject({
      version: 1,
      preset: 'every-frame',
    })
    expect(settled.engine.rollingShadow.rollingShadowUpdateRequestCount).toBe(
      settled.engine.rollingShadow.rollingRenderFrameCount,
    )
    const profile = settled.engine.performanceProfile
    expect(profile, 'rolling CPU profile must be present in explicit profile mode').toBeDefined()
    expect(profile).toMatchObject({
      version: 1,
      sampleKind: 'rolling-cpu',
      rendererTimingKind: 'cpu-submit',
    })
    expect(typeof profile!.currentFrameExcluded).toBe('boolean')
    expect(profile!.totalFrameCount).toBeGreaterThan(0)
    expect(profile!.retainedFrameCount).toBeGreaterThan(0)
    expect(Object.keys(profile!.metrics).sort()).toEqual(
      [
        'rafRawDeltaMs',
        'rafClampedDeltaMs',
        'cannonStepnumberDelta',
        'worldStepCpuMs',
        'guardCpuMs',
        'rollSafetyCpuMs',
        'settleCpuMs',
        'transformSyncCpuMs',
        'rendererSubmitCpuMs',
        'diagnosticsPublishCpuMs',
        'tickTotalCpuMs',
      ].sort(),
    )
    for (const [metric, distribution] of Object.entries(profile!.metrics)) {
      expect(distribution.count, `${metric} sample count`).toBe(profile!.retainedFrameCount)
      expect(Number.isFinite(distribution.p50), `${metric} p50 must be finite`).toBe(true)
      expect(Number.isFinite(distribution.p95), `${metric} p95 must be finite`).toBe(true)
      expect(Number.isFinite(distribution.max), `${metric} max must be finite`).toBe(true)
    }
    expect(profile!.metrics.cannonStepnumberDelta.max).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(profile!.metrics.cannonStepnumberDelta.max)).toBe(true)
    expect(profile!.metrics.cannonStepnumberDelta.max).toBeLessThanOrEqual(6)
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
