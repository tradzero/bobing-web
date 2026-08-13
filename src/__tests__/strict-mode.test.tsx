import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import { GameViewport } from '@/ui/components/GameViewport'

/**
 * StrictMode 重挂载测试
 * Mock 3D / 物理 / 引擎依赖，验证 mount → unmount → remount 后：
 *   1. 只有一个 canvas 留在 DOM
 *   2. createEngine / dispose 调用次数成对
 *   3. 没有残留 rAF 或 observer
 */

// ── Mock 依赖 ──

// 追踪 engine 创建 / dispose 调用
const engineCreateCalls: number[] = []
const engineDisposeCalls: number[] = []
const diceSetCreateCalls: number[] = []
const diceSetDisposeCalls: number[] = []
type DiagnosticSnapshot = {
  mode: 'idle' | 'rolling' | 'settled' | 'stopped'
  renderCount: number
  physicsStepCount: number
  frameScheduled: boolean
  rollingShadow: {
    version: 1
    preset: 'every-frame'
    rollingRenderFrameCount: number
    rollingShadowUpdateRequestCount: number
    maxConsecutiveRollingFramesWithoutShadowUpdateRequest: number
  }
}
const diagnosticPublishers: Array<(diagnostics: DiagnosticSnapshot) => void> = []
const enginePerformanceProfiles: unknown[] = []
const engineRollingShadowPresets: unknown[] = []
const engineSchedulerVariants: unknown[] = []
const engineStepExactCallbacks: unknown[] = []
const engineRollErrorCallbacks: unknown[] = []
const engineClocks: unknown[] = []
const engineInitiallyHidden: unknown[] = []
const engineVisibilityCalls: Array<{ id: number; hidden: boolean; timestampMs: number }> = []
let callCounter = 0
let diceSetCallCounter = 0

vi.mock('@/scene/setup', () => ({
  createScene: () => {
    const mockScene = {
      add: vi.fn(),
      remove: vi.fn(),
      traverse: vi.fn(),
      background: null,
    }
    return {
      scene: mockScene,
      camera: {},
      renderer: {
        render: vi.fn(),
        dispose: vi.fn(),
        setSize: vi.fn(),
        setPixelRatio: vi.fn(),
        getDrawingBufferSize: vi.fn((target: { set: (x: number, y: number) => unknown }) =>
          target.set(1280, 720),
        ),
        getPixelRatio: vi.fn(() => 1.5),
        info: {
          render: { calls: 6, triangles: 1_234 },
          memory: { geometries: 4, textures: 9 },
          programs: [{}, {}],
        },
        shadowMap: { enabled: false },
      },
      handleResize: vi.fn(),
      dispose: vi.fn(),
    }
  },
}))

vi.mock('@/scene/table', () => ({
  createTable: () => ({ position: { y: 0 } }),
}))

vi.mock('@/scene/bowl', () => ({
  createBowl: () => ({}),
}))

vi.mock('@/physics/world', () => ({
  createPhysicsWorld: () => ({
    world: {
      addBody: vi.fn(),
      step: vi.fn(),
    },
    step: vi.fn(),
    stepExact: vi.fn(),
    dispose: vi.fn(),
  }),
}))

vi.mock('@/physics/materials', () => ({
  setupContactMaterials: vi.fn(),
}))

vi.mock('@/physics/bowl-body', () => ({
  createBowlBodies: vi.fn(),
  ESCAPE_Y: 0.9,
}))

// Mock 骰子创建：保留 DiceSet 的共享 object3d / dispose 所有权契约。
vi.mock('@/dice/create', () => ({
  createDiceSet: () => {
    const id = ++diceSetCallCounter
    diceSetCreateCalls.push(id)
    return {
      object3d: { id },
      pairs: Array.from({ length: 6 }, () => ({
        mesh: {
          position: { set: vi.fn() },
          quaternion: { set: vi.fn() },
        },
        body: {
          position: { set: vi.fn(), copy: vi.fn(), x: 0, y: 0.3, z: 0 },
          previousPosition: { copy: vi.fn() },
          interpolatedPosition: { copy: vi.fn() },
          velocity: { set: vi.fn(), y: 0 },
          angularVelocity: { set: vi.fn() },
          quaternion: { set: vi.fn(), x: 0, y: 0, z: 0, w: 1 },
          previousQuaternion: { copy: vi.fn() },
          interpolatedQuaternion: { copy: vi.fn() },
          force: { set: vi.fn() },
          torque: { set: vi.fn() },
          aabbNeedsUpdate: false,
          wakeUp: vi.fn(),
          sleep: vi.fn(),
          sleepState: 0,
        },
      })),
      dispose: () => {
        diceSetDisposeCalls.push(id)
      },
    }
  },
}))

vi.mock('@/game/engine', () => ({
  createEngine: (options: {
    onDiagnostics?: (diagnostics: DiagnosticSnapshot) => void
    performanceProfile?: unknown
    rollingShadowPreset?: unknown
    physicsSchedulerVariant?: unknown
    stepExact?: unknown
    onRollError?: unknown
    clock?: unknown
    initiallyHidden?: unknown
  }) => {
    const id = ++callCounter
    engineCreateCalls.push(id)
    if (options.onDiagnostics) diagnosticPublishers.push(options.onDiagnostics)
    enginePerformanceProfiles.push(options.performanceProfile)
    engineRollingShadowPresets.push(options.rollingShadowPreset)
    engineSchedulerVariants.push(options.physicsSchedulerVariant)
    engineStepExactCallbacks.push(options.stepExact)
    engineRollErrorCallbacks.push(options.onRollError)
    engineClocks.push(options.clock)
    engineInitiallyHidden.push(options.initiallyHidden)
    return {
      start: vi.fn(),
      stop: vi.fn(),
      dispose: () => {
        engineDisposeCalls.push(id)
      },
      beginSettle: vi.fn(),
      returnToIdle: vi.fn(),
      invalidate: vi.fn(),
      getDiagnostics: vi.fn(),
      setPageVisibility: (hidden: boolean, timestampMs: number) => {
        engineVisibilityCalls.push({ id, hidden, timestampMs })
      },
    }
  },
}))

beforeEach(() => {
  callCounter = 0
  diceSetCallCounter = 0
  engineCreateCalls.length = 0
  engineDisposeCalls.length = 0
  diceSetCreateCalls.length = 0
  diceSetDisposeCalls.length = 0
  diagnosticPublishers.length = 0
  enginePerformanceProfiles.length = 0
  engineRollingShadowPresets.length = 0
  engineSchedulerVariants.length = 0
  engineStepExactCallbacks.length = 0
  engineRollErrorCallbacks.length = 0
  engineClocks.length = 0
  engineInitiallyHidden.length = 0
  engineVisibilityCalls.length = 0
})

describe('StrictMode 重挂载', () => {
  it('mount → unmount → remount 后只有一个 canvas', () => {
    // 第一次挂载 + 卸载
    const { unmount: unmount1, container: container1 } = render(
      <StrictMode>
        <GameViewport />
      </StrictMode>,
    )
    unmount1()
    expect(container1.querySelectorAll('canvas')).toHaveLength(0)

    // 第二次挂载
    const { container: container2 } = render(
      <StrictMode>
        <GameViewport />
      </StrictMode>,
    )
    expect(container2.querySelectorAll('canvas')).toHaveLength(1)
  })

  it('engine create / dispose 调用次数成对', () => {
    const { unmount } = render(
      <StrictMode>
        <GameViewport />
      </StrictMode>,
    )
    // StrictMode 下 React 会 mount → unmount → remount
    // 所以 create 可能 >= 1，但 unmount 时 dispose 应成对

    unmount()

    // 卸载后 engine dispose 调用数应等于 create 调用数
    expect(engineDisposeCalls.length).toBe(engineCreateCalls.length)
  })

  it('remount 后无残留 canvas（StrictMode 双调用安全）', () => {
    // 用 StrictMode 渲染（会触发 useEffect 双调用）
    const { container } = render(
      <StrictMode>
        <GameViewport>
          <div data-testid="child">overlay</div>
        </GameViewport>
      </StrictMode>,
    )

    // 应该只有 1 个 canvas（StrictMode 的第二次 mount cleanup 了第一次的）
    const canvases = container.querySelectorAll('canvas')
    expect(canvases).toHaveLength(1)
  })

  it('dispose 和 create 的 ID 配对正确', () => {
    const { unmount } = render(
      <StrictMode>
        <GameViewport />
      </StrictMode>,
    )
    unmount()

    // 每个 create 的 engine 都应该被 dispose
    for (const id of engineCreateCalls) {
      expect(engineDisposeCalls.includes(id), `engine #${id} created but not disposed`).toBe(true)
    }

    for (const id of diceSetCreateCalls) {
      expect(diceSetDisposeCalls.includes(id), `dice set #${id} created but not disposed`).toBe(
        true,
      )
    }
  })

  it('开发态 dataset 明确报告主 pass 与 GPU 资源计数', () => {
    const { container, unmount } = render(<GameViewport />)
    const publish = diagnosticPublishers.at(-1)
    expect(publish).toBeDefined()

    publish?.({
      mode: 'idle',
      renderCount: 1,
      physicsStepCount: 0,
      frameScheduled: false,
      rollingShadow: {
        version: 1,
        preset: 'every-frame',
        rollingRenderFrameCount: 0,
        rollingShadowUpdateRequestCount: 0,
        maxConsecutiveRollingFramesWithoutShadowUpdateRequest: 0,
      },
    })

    const canvas = container.querySelector('canvas')
    const diagnostics = JSON.parse(canvas?.dataset.diceDiagnostics ?? '{}')
    expect(diagnostics).toMatchObject({
      schemaVersion: 8,
      revision: 1,
      sampleKind: 'post-render',
      physicsSchedulerExperiment: {
        version: 1,
        explicit: false,
        variant: 'legacy-batched',
        kind: 'legacy-batched',
        maxStepsPerFrame: null,
      },
      renderExperiment: {
        version: 1,
        explicit: false,
        variant: 'rolling-dpr-reduced-tier',
        rollingDprPreset: 'cap-1x-reduced-tier',
        rollingShadowPreset: 'every-frame',
      },
      roll: {
        seed: null,
        throwAlgorithmVersion: 3,
        placementAlgorithm: null,
        placementAttempts: null,
        placementRestarts: null,
        placementGroupAttempts: null,
        randomPlanVersion: null,
        placementPath: null,
        fallbackLayout: null,
        initialState: null,
        finalState: null,
        settleAlgorithmVersion: 4,
        settleReason: null,
        settleElapsed: null,
      },
    })
    expect(diagnostics.render).toMatchObject({
      mainPassCalls: 6,
      mainPassTriangles: 1_234,
      geometries: 4,
      textures: 9,
      programs: 2,
    })
    expect(diagnostics.render.calls).toBeUndefined()
    expect(diagnostics.engine.performanceProfile).toBeUndefined()
    expect(enginePerformanceProfiles.every((profile) => profile === undefined)).toBe(true)
    expect(engineRollingShadowPresets.every((preset) => preset === 'every-frame')).toBe(true)
    expect(engineSchedulerVariants).not.toHaveLength(0)
    expect(engineSchedulerVariants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'legacy-batched', kind: 'legacy-batched' }),
      ]),
    )
    expect(engineStepExactCallbacks.every((callback) => typeof callback === 'function')).toBe(true)
    expect(engineRollErrorCallbacks.every((callback) => typeof callback === 'function')).toBe(true)
    expect(engineClocks.every((clock) => typeof clock === 'function')).toBe(true)
    expect(engineInitiallyHidden.every((hidden) => hidden === document.hidden)).toBe(true)

    unmount()
  })

  it('visibilitychange 只通知当前 engine，卸载后不残留 listener', () => {
    const { unmount } = render(<GameViewport />)
    document.dispatchEvent(new Event('visibilitychange'))

    expect(engineVisibilityCalls).toHaveLength(1)
    expect(engineVisibilityCalls[0]).toMatchObject({
      id: engineCreateCalls.at(-1),
      hidden: document.hidden,
    })
    expect(Number.isFinite(engineVisibilityCalls[0].timestampMs)).toBe(true)

    unmount()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(engineVisibilityCalls).toHaveLength(1)
  })
})
