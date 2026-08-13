import { expect, type Page, type TestInfo } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

export const E2E_NEXT_SEED = 42

/**
 * 浏览器结构预算的单一来源。
 * 所有 browser bench 只消费此常量，渲染结构改变时避免散落修改断言。
 */
export const BROWSER_BUDGETS = {
  diagnosticsSchemaVersion: 3,
  mainPassCalls: 8,
  mainPassTriangles: 41_288,
  geometries: 8,
  maxTextures: 6,
  maxPrograms: {
    desktop: {
      idle: 8,
      rolling: 10,
      settled: 10,
    },
    mobile: {
      // 移动布局会在首屏 ResizeObserver 补帧后编译完整阴影变体。
      idle: 10,
      rolling: 10,
      settled: 10,
    },
  },
  minPixelRatio: 1,
  maxPixelRatio: 1.5,
  maxDrawingBufferPixels: 3_500_000,
  desktopMinDrawingBufferPixels: 3_450_000,
  staticObservationMs: 300,
  settlementWallTimeoutMs: 20_000,
} as const

export type RuntimeEngineMode = 'idle' | 'rolling' | 'settled' | 'stopped'

export interface DiceRuntimeDiagnostics {
  schemaVersion: number
  revision: number
  sampleKind: 'post-render'
  engine: {
    mode: RuntimeEngineMode
    renderCount: number
    physicsStepCount: number
    frameScheduled: boolean
    rollSafety: {
      maxRadius: number
      containmentRadius: number
      conservativeContainmentRadius: number
      conservativeBoundaryCrossings: number
      wallCenterCrossings: number
      maxContactPenetration: number
      escapeGuardInterventionCount: number
      nonFiniteBodyStateDetected: boolean
    }
  }
  roll: {
    seed: number | null
    throwAlgorithmVersion: number
    placementAlgorithm:
      | 'legacy-v1'
      | 'radial-rejection'
      | 'uniform-area-restarts'
      | 'stratified-ring'
      | null
    placementAttempts: number | null
    placementRestarts: number | null
    placementGroupAttempts: number | null
    randomPlanVersion: number | null
    placementPath: 'rejection' | 'constructive' | 'fallback' | null
    fallbackLayout: 'ring6' | 'dual33' | 'center15' | null
    settleAlgorithmVersion: number
    settleReason:
      | 'natural-sleep'
      | 'stable-window'
      | 'pose-stable-window'
      | 'cluster-assist'
      | 'timeout'
      | 'external-call'
      | null
    settleElapsed: number | null
  }
  render: {
    cssWidth: number
    cssHeight: number
    drawingBufferWidth: number
    drawingBufferHeight: number
    drawingBufferPixels: number
    pixelRatio: number
    mainPassCalls: number
    mainPassTriangles: number
    geometries: number
    textures: number
    programs: number
  }
}

export interface BrowserIssues {
  consoleErrors: string[]
  pageErrors: string[]
}

export interface RafStats {
  samples: number
  durationMs: number
  p50Ms: number | null
  p95Ms: number | null
  maxMs: number | null
  longFrameRatio: number | null
}

interface WaitForPostRenderOptions {
  mode: RuntimeEngineMode
  afterRevision?: number
  afterRenderCount?: number
  frameScheduled?: boolean
  timeout?: number
}

export function collectBrowserIssues(page: Page): BrowserIssues {
  const issues: BrowserIssues = { consoleErrors: [], pageErrors: [] }
  page.on('console', (message) => {
    if (message.type() === 'error') issues.consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => issues.pageErrors.push(error.message))
  return issues
}

export async function readDiagnostics(page: Page): Promise<DiceRuntimeDiagnostics | null> {
  const serialized = await page.locator('canvas').getAttribute('data-dice-diagnostics')
  if (!serialized) return null

  try {
    return JSON.parse(serialized) as DiceRuntimeDiagnostics
  } catch {
    return null
  }
}

function isExpectedPostRender(
  diagnostics: DiceRuntimeDiagnostics | null,
  options: WaitForPostRenderOptions,
): boolean {
  if (!diagnostics) return false
  if (diagnostics.schemaVersion !== BROWSER_BUDGETS.diagnosticsSchemaVersion) return false
  if (diagnostics.sampleKind !== 'post-render') return false
  if (diagnostics.revision <= (options.afterRevision ?? 0)) return false
  if (diagnostics.engine.renderCount <= (options.afterRenderCount ?? -1)) return false
  if (diagnostics.engine.mode !== options.mode) return false
  if (diagnostics.render.mainPassCalls <= 0) return false
  if (
    options.frameScheduled !== undefined &&
    diagnostics.engine.frameScheduled !== options.frameScheduled
  ) {
    return false
  }
  return true
}

export async function waitForPostRender(
  page: Page,
  options: WaitForPostRenderOptions,
): Promise<DiceRuntimeDiagnostics> {
  await expect
    .poll(async () => isExpectedPostRender(await readDiagnostics(page), options), {
      timeout: options.timeout ?? BROWSER_BUDGETS.settlementWallTimeoutMs,
      message: `waiting for ${options.mode} post-render diagnostics after revision ${options.afterRevision ?? 0}`,
    })
    .toBe(true)

  const diagnostics = await readDiagnostics(page)
  if (!diagnostics) throw new Error('post-render diagnostics disappeared after readiness check')
  return diagnostics
}

export async function expectNoStaticFrames(
  page: Page,
  diagnostics: DiceRuntimeDiagnostics,
): Promise<void> {
  await page.waitForTimeout(BROWSER_BUDGETS.staticObservationMs)
  const after = await readDiagnostics(page)
  expect(after, 'static diagnostics must remain available').not.toBeNull()
  expect(after!.revision, 'static scene unexpectedly published another render').toBe(
    diagnostics.revision,
  )
  expect(after!.engine.renderCount, 'static scene unexpectedly rendered another frame').toBe(
    diagnostics.engine.renderCount,
  )
}

/** 容忍首屏 React/CSS 布局完成后的一次合法 resize，但最终必须出现零帧增长窗口。 */
export async function waitForStaticQuiescence(
  page: Page,
  initial: DiceRuntimeDiagnostics,
): Promise<DiceRuntimeDiagnostics> {
  let current = initial
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.waitForTimeout(BROWSER_BUDGETS.staticObservationMs)
    const after = await readDiagnostics(page)
    if (
      after &&
      after.engine.mode === current.engine.mode &&
      after.engine.frameScheduled === false &&
      after.engine.renderCount === current.engine.renderCount
    ) {
      return after
    }
    if (after) current = after
  }

  throw new Error(
    `static scene did not quiesce: mode=${current.engine.mode}, renderCount=${current.engine.renderCount}`,
  )
}

export async function waitForSettlementUi(page: Page): Promise<void> {
  const settlement = page.locator('.result-panel, .tilt-warning')
  await expect(settlement).toBeVisible({ timeout: BROWSER_BUDGETS.settlementWallTimeoutMs })

  const tiltWarning = page.locator('.tilt-warning')
  if (await tiltWarning.isVisible()) {
    await page.getByRole('button', { name: '接受结果' }).click()
  }
  await expect(page.locator('.result-panel')).toBeVisible()
}

export function expectRenderBudgets(
  diagnostics: DiceRuntimeDiagnostics,
  projectName: string,
): void {
  const { render, engine } = diagnostics
  const expectedWidth = Math.floor(render.cssWidth * render.pixelRatio)
  const expectedHeight = Math.floor(render.cssHeight * render.pixelRatio)

  expect(render.pixelRatio, `[${projectName}] pixelRatio lower bound`).toBeGreaterThanOrEqual(
    BROWSER_BUDGETS.minPixelRatio,
  )
  expect(render.pixelRatio, `[${projectName}] pixelRatio upper bound`).toBeLessThanOrEqual(
    BROWSER_BUDGETS.maxPixelRatio,
  )
  expect(
    Math.abs(render.drawingBufferWidth - expectedWidth),
    `[${projectName}] drawingBufferWidth must track CSS width * DPR`,
  ).toBeLessThanOrEqual(1)
  expect(
    Math.abs(render.drawingBufferHeight - expectedHeight),
    `[${projectName}] drawingBufferHeight must track CSS height * DPR`,
  ).toBeLessThanOrEqual(1)
  expect(
    render.drawingBufferPixels,
    `[${projectName}] drawing-buffer pixel budget`,
  ).toBeLessThanOrEqual(BROWSER_BUDGETS.maxDrawingBufferPixels)
  if (projectName.startsWith('desktop')) {
    expect(
      render.drawingBufferPixels,
      `[${projectName}] quality unexpectedly dropped below the desktop baseline`,
    ).toBeGreaterThanOrEqual(BROWSER_BUDGETS.desktopMinDrawingBufferPixels)
  }

  expect(render.mainPassCalls, `[${projectName}][${engine.mode}] main pass calls`).toBe(
    BROWSER_BUDGETS.mainPassCalls,
  )
  expect(render.mainPassTriangles, `[${projectName}][${engine.mode}] main pass triangles`).toBe(
    BROWSER_BUDGETS.mainPassTriangles,
  )
  expect(render.geometries, `[${projectName}][${engine.mode}] geometry resources`).toBe(
    BROWSER_BUDGETS.geometries,
  )
  expect(render.textures, `[${projectName}][${engine.mode}] texture resources`).toBeLessThanOrEqual(
    BROWSER_BUDGETS.maxTextures,
  )
  expect(render.programs, `[${projectName}][${engine.mode}] compiled programs`).toBeGreaterThan(0)
  if (engine.mode !== 'stopped') {
    const platform = projectName.startsWith('mobile') ? 'mobile' : 'desktop'
    expect(
      render.programs,
      `[${projectName}][${engine.mode}] compiled programs`,
    ).toBeLessThanOrEqual(BROWSER_BUDGETS.maxPrograms[platform][engine.mode])
  }
}

export async function measureRaf(page: Page, durationMs = 1_200): Promise<RafStats> {
  return page.evaluate(async (duration) => {
    const timestamps: number[] = []
    const start = performance.now()

    await new Promise<void>((resolve) => {
      const sample = (timestamp: number) => {
        timestamps.push(timestamp)
        if (performance.now() - start >= duration) resolve()
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })

    const intervals = timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index])
    intervals.sort((a, b) => a - b)
    const percentile = (fraction: number) =>
      intervals.length === 0
        ? null
        : intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * fraction))]

    return {
      samples: intervals.length,
      durationMs: performance.now() - start,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: intervals.at(-1) ?? null,
      longFrameRatio:
        intervals.length === 0
          ? null
          : intervals.filter((interval) => interval > 33.34).length / intervals.length,
    }
  }, durationMs)
}

export async function readBrowserMetadata(page: Page): Promise<Record<string, unknown>> {
  const metadata = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
    const debug = gl?.getExtension('WEBGL_debug_renderer_info')
    return {
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      webglVersion: gl?.getParameter(gl.VERSION) ?? null,
      webglVendor: debug ? gl?.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      webglRenderer: debug ? gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
    }
  })

  return { ...metadata, commit: currentCommit(), node: process.version }
}

function currentCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

export async function writeBenchArtifact(
  page: Page,
  testInfo: TestInfo,
  artifact: Record<string, unknown>,
): Promise<void> {
  const jsonPath = testInfo.outputPath('browser-bench.json')
  await writeFile(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  await testInfo.attach('browser-bench', { path: jsonPath, contentType: 'application/json' })

  if (!page.isClosed()) {
    const screenshotPath = testInfo.outputPath('settled.png')
    await page.screenshot({ path: screenshotPath, fullPage: true })
    await testInfo.attach('settled-page', {
      path: screenshotPath,
      contentType: 'image/png',
    })
  }
}
