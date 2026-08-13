// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as CANNON from 'cannon-es'
import * as THREE from 'three'
import type { DicePair } from '@/dice/create'
import type { SettleResult } from '@/dice/settle'
import { createEngine, type Engine, type EngineDiagnostics } from '@/game/engine'
import {
  ROLLING_CPU_PROFILE_METRICS,
  type RollingCpuProfileSnapshot,
} from '@/game/performance-profile'
import type { RollingShadowPreset } from '@/game/rolling-shadow'
import type { SceneContext } from '@/scene/setup'
import type { RenderPhase } from '@/config/render'
import { CONSERVATIVE_DICE_CENTER_RADIUS, WALL_INNER_RADIUS } from '@/physics/roll-diagnostics'
import { PHYSICS } from '@/config/physics'
import {
  getPhysicsSchedulerVariant,
  type PhysicsSchedulerVariant,
  type PhysicsSchedulerVariantId,
} from '@/game/physics-scheduler-experiment'
import type { RollError } from '@/game/roll-error'

type MockSceneContext = Omit<SceneContext, 'renderer' | 'setRenderPhase'> & {
  setRenderPhase: ReturnType<typeof vi.fn<(phase: RenderPhase) => void>>
  renderer: THREE.WebGLRenderer & {
    render: ReturnType<typeof vi.fn>
    shadowMap: {
      autoUpdate: boolean
      needsUpdate: boolean
    }
  }
}

const ZERO_ROLL_SAFETY = {
  maxRadius: 0,
  containmentRadius: WALL_INNER_RADIUS,
  conservativeContainmentRadius: CONSERVATIVE_DICE_CENTER_RADIUS,
  conservativeBoundaryCrossings: 0,
  wallCenterCrossings: 0,
  maxContactPenetration: 0,
  escapeGuardInterventionCount: 0,
  nonFiniteBodyStateDetected: false,
} as const

const ZERO_ROLLING_SHADOW = {
  version: 1,
  preset: 'every-frame',
  rollingRenderFrameCount: 0,
  rollingShadowUpdateRequestCount: 0,
  maxConsecutiveRollingFramesWithoutShadowUpdateRequest: 0,
} as const

const ZERO_PHYSICS_TIMING = {
  version: 1,
  preset: 'legacy-batched',
  kind: 'legacy-batched',
  maxStepsPerFrame: null,
  fixedStepMs: PHYSICS.fixedTimeStep * 1000,
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
  overload: { active: false, highWaterMs: 250 },
  terminalAbandoned: null,
  suspended: false,
} as const

function mockSceneCtx(): MockSceneContext {
  const renderer = {
    render: vi.fn(),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    dispose: vi.fn(),
    domElement: document.createElement('canvas'),
    shadowMap: {
      autoUpdate: true,
      needsUpdate: false,
    },
  } as unknown as MockSceneContext['renderer']

  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    renderer,
    handleResize: vi.fn(),
    setRenderPhase: vi.fn<(phase: RenderPhase) => void>(),
    dispose: vi.fn(),
  }
}

function makeDicePairs(count = 1, sleeping = false): DicePair[] {
  return Array.from({ length: count }, () => {
    const body = new CANNON.Body({ mass: 0.03, allowSleep: true })
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.02, 0.02, 0.02)))
    if (sleeping) body.sleep()

    return {
      body,
      mesh: new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), new THREE.MeshBasicMaterial()),
    }
  })
}

describe('Engine 按需调度', () => {
  let pendingFrames: Map<number, FrameRequestCallback>
  let nextFrameId: number
  let engines: Engine[]

  beforeEach(() => {
    pendingFrames = new Map()
    nextFrameId = 0
    engines = []

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrameId
      pendingFrames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      pendingFrames.delete(id)
    })
  })

  afterEach(() => {
    for (const engine of engines) engine.dispose()
    vi.unstubAllGlobals()
  })

  function createFixture(options?: {
    dicePairs?: DicePair[]
    world?: CANNON.World
    worldStep?: (dt: number) => void
    stepExact?: () => void
    onSettled?: (result: SettleResult) => void
    onRollError?: (error: RollError) => void
    physicsSchedulerVariant?: Readonly<PhysicsSchedulerVariant>
    clock?: () => number
    initiallyHidden?: boolean
    onDiagnostics?: (diagnostics: EngineDiagnostics) => void
    rollingShadowPreset?: RollingShadowPreset
    performanceProfile?: { now: () => number; capacity?: number }
  }) {
    const sceneCtx = mockSceneCtx()
    const dicePairs = options?.dicePairs ?? makeDicePairs()
    const worldStep = options?.worldStep ?? vi.fn()
    const onSettled = options?.onSettled ?? vi.fn()
    const world = options?.world ?? new CANNON.World()
    const engine = createEngine({
      sceneCtx,
      world,
      worldStep,
      stepExact: options?.stepExact,
      dicePairs,
      onSettled,
      onRollError: options?.onRollError,
      physicsSchedulerVariant: options?.physicsSchedulerVariant,
      clock: options?.clock,
      initiallyHidden: options?.initiallyHidden,
      onDiagnostics: options?.onDiagnostics,
      rollingShadowPreset: options?.rollingShadowPreset,
      performanceProfile: options?.performanceProfile,
    })
    engines.push(engine)
    return { engine, sceneCtx, dicePairs, worldStep, onSettled }
  }

  function createExactFixture(options?: {
    variant?: Extract<PhysicsSchedulerVariantId, 'exact-cap6' | 'exact-cap4'>
    dicePairs?: DicePair[]
    clock?: () => number
    onSettled?: (result: SettleResult) => void
    onRollError?: (error: RollError) => void
    onDiagnostics?: (diagnostics: EngineDiagnostics) => void
    performanceProfile?: { now: () => number; capacity?: number }
  }) {
    const world = new CANNON.World()
    world.gravity.set(0, 0, 0)
    world.allowSleep = true
    const dicePairs = options?.dicePairs ?? makeDicePairs()
    for (const { body } of dicePairs) world.addBody(body)
    const onRollError = options?.onRollError ?? vi.fn()
    const fixture = createFixture({
      world,
      dicePairs,
      worldStep: vi.fn(),
      stepExact: () => world.step(PHYSICS.fixedTimeStep),
      onSettled: options?.onSettled,
      onRollError,
      physicsSchedulerVariant: getPhysicsSchedulerVariant(options?.variant ?? 'exact-cap4'),
      clock: options?.clock ?? (() => 0),
      onDiagnostics: options?.onDiagnostics,
      performanceProfile: options?.performanceProfile,
    })
    return { ...fixture, world, onRollError }
  }

  it('exact scheduler 缺少 stepExact 或 onRollError 时拒绝构造', () => {
    const sceneCtx = mockSceneCtx()
    const world = new CANNON.World()
    const dicePairs = makeDicePairs()
    const base = {
      sceneCtx,
      world,
      worldStep: vi.fn(),
      dicePairs,
      onSettled: vi.fn(),
      physicsSchedulerVariant: getPhysicsSchedulerVariant('exact-cap4'),
    }

    expect(() => createEngine({ ...base, onRollError: vi.fn() })).toThrow(/stepExact/)
    expect(() => createEngine({ ...base, stepExact: vi.fn() })).toThrow(/onRollError/)
  })

  it('exact cap4 连续六个 100ms 帧在第六帧显式 overload，且不走正常结算', () => {
    const dicePairs = makeDicePairs()
    dicePairs[0].body.allowSleep = false
    dicePairs[0].body.velocity.set(1, 0, 0)
    const onSettled = vi.fn()
    const onRollError = vi.fn()
    const { engine, worldStep } = createExactFixture({ dicePairs, onSettled, onRollError })

    engine.start()
    engine.beginSettle()
    for (const timestamp of [100, 200, 300, 400, 500, 600]) runNextFrame(timestamp)

    expect(worldStep).not.toHaveBeenCalled()
    expect(onSettled).not.toHaveBeenCalled()
    expect(onRollError).toHaveBeenCalledOnce()
    expect(onRollError).toHaveBeenCalledWith({
      reason: 'timing-overload',
      simulationElapsed: 20 * PHYSICS.fixedTimeStep,
      queuedMs: expect.closeTo(800 / 3, 8),
      highWaterMs: 250,
      executedSteps: 20,
    })
    expect(engine.getDiagnostics()).toMatchObject({
      mode: 'error',
      physicsStepCount: 20,
      frameScheduled: false,
      physicsTiming: {
        preset: 'exact-cap4',
        simulationStep: 20,
        simulationTime: 20 * PHYSICS.fixedTimeStep,
        totalRawWallDeltaMs: 600,
        totalAcceptedWallDeltaMs: 600,
        totalDiscardedWallDeltaMs: 0,
        totalExecutedSteps: 20,
        queuedMs: expect.closeTo(800 / 3, 8),
        queuedWholeSteps: 16,
        overload: { active: true, highWaterMs: 250 },
        terminalAbandoned: {
          reason: 'timing-overload',
          queuedMs: expect.closeTo(800 / 3, 8),
          queuedWholeSteps: 16,
        },
      },
    })
    expect(pendingFrames.size).toBe(0)
  })

  it('exact settle 只消费真实完成的步，并把同帧剩余 backlog 记为 abandoned', () => {
    const dicePairs = makeDicePairs(1, true)
    const onSettled = vi.fn()
    const { engine } = createExactFixture({
      variant: 'exact-cap6',
      dicePairs,
      onSettled,
    })

    engine.start()
    engine.beginSettle()
    runNextFrame(100)

    expect(onSettled).toHaveBeenCalledOnce()
    expect(onSettled).toHaveBeenCalledWith({
      reason: 'natural-sleep',
      elapsed: PHYSICS.fixedTimeStep,
    })
    expect(engine.getDiagnostics()).toMatchObject({
      mode: 'settled',
      physicsStepCount: 1,
      frameScheduled: false,
      physicsTiming: {
        simulationStep: 1,
        totalExecutedSteps: 1,
        queuedMs: expect.closeTo(100 - 1000 / 60, 8),
        terminalAbandoned: {
          reason: 'settled',
          queuedMs: expect.closeTo(100 - 1000 / 60, 8),
          queuedWholeSteps: 5,
        },
      },
    })
  })

  it('exact timeout 走错误回调，不读作普通 settled', () => {
    const dicePairs = makeDicePairs()
    dicePairs[0].body.allowSleep = false
    dicePairs[0].body.angularVelocity.set(0, 1, 0)
    const onSettled = vi.fn()
    const onRollError = vi.fn()
    const { engine } = createExactFixture({
      variant: 'exact-cap6',
      dicePairs,
      onSettled,
      onRollError,
    })

    engine.start()
    engine.beginSettle()
    for (let frame = 1; frame <= 100 && pendingFrames.size > 0; frame++) {
      runNextFrame(frame * 100)
    }

    expect(onSettled).not.toHaveBeenCalled()
    expect(onRollError).toHaveBeenCalledWith({
      reason: 'timeout',
      elapsed: expect.closeTo(10, 8),
    })
    expect(engine.getDiagnostics()).toMatchObject({
      mode: 'error',
      physicsStepCount: 600,
      physicsTiming: {
        simulationStep: 600,
        terminalAbandoned: { reason: 'timeout' },
      },
    })
  })

  it('exact visibility 将 hidden 时间只记为 paused，并在 resume 后排空既有 backlog', () => {
    const dicePairs = makeDicePairs()
    dicePairs[0].body.allowSleep = false
    dicePairs[0].body.velocity.set(1, 0, 0)
    const { engine } = createExactFixture({ dicePairs })

    engine.start()
    engine.beginSettle()
    runNextFrame(100)
    expect(engine.getDiagnostics().physicsTiming).toMatchObject({
      simulationStep: 4,
      queuedMs: expect.closeTo(100 / 3, 8),
    })

    engine.setPageVisibility?.(true, 100)
    expect(pendingFrames.size).toBe(0)
    engine.setPageVisibility?.(false, 5_100)
    expect(engine.getDiagnostics().physicsTiming).toMatchObject({
      simulationStep: 4,
      totalRawWallDeltaMs: 5_100,
      totalAcceptedWallDeltaMs: 100,
      totalPausedWallDeltaMs: 5_000,
      totalDiscardedWallDeltaMs: 5_000,
      queuedMs: expect.closeTo(100 / 3, 8),
      suspended: false,
    })

    runNextFrame(5_100)
    expect(engine.getDiagnostics().physicsTiming).toMatchObject({
      simulationStep: 6,
      totalAcceptedWallDeltaMs: 100,
      queuedMs: 0,
    })
  })

  it('visibility 时钟回退不把回退差额补算到 paused 时间', () => {
    const dicePairs = makeDicePairs()
    dicePairs[0].body.allowSleep = false
    dicePairs[0].body.velocity.set(1, 0, 0)
    const { engine } = createExactFixture({ dicePairs, clock: () => 100 })

    engine.start()
    engine.beginSettle()
    engine.setPageVisibility?.(true, 90)
    engine.setPageVisibility?.(false, 200)

    expect(engine.getDiagnostics().physicsTiming).toMatchObject({
      totalRawWallDeltaMs: 100,
      totalAcceptedWallDeltaMs: 0,
      totalPausedWallDeltaMs: 100,
      totalDiscardedWallDeltaMs: 100,
    })
  })

  it('hidden 尾段触发 settle 时不渲染，恢复后才提交唯一静态帧', () => {
    const dicePairs = makeDicePairs(1, true)
    const onDiagnostics = vi.fn()
    const onSettled = vi.fn()
    const { engine, sceneCtx } = createExactFixture({
      variant: 'exact-cap6',
      dicePairs,
      onSettled,
      onDiagnostics,
    })

    engine.start()
    engine.beginSettle()
    engine.setPageVisibility?.(true, 20)

    expect(onSettled).toHaveBeenCalledOnce()
    expect(engine.getDiagnostics()).toMatchObject({
      mode: 'settled',
      renderCount: 0,
      frameScheduled: false,
      physicsTiming: { suspended: true },
    })
    expect(sceneCtx.renderer.render).not.toHaveBeenCalled()
    expect(onDiagnostics).not.toHaveBeenCalled()

    engine.setPageVisibility?.(false, 1_020)
    runNextFrame(1_020)
    expect(sceneCtx.renderer.render).toHaveBeenCalledOnce()
    expect(onDiagnostics).toHaveBeenCalledOnce()
  })

  it('exact stop/dispose 保留 terminal backlog 原因，且多轮物理步计数单调累计', () => {
    const dicePairs = makeDicePairs()
    dicePairs[0].body.allowSleep = false
    dicePairs[0].body.velocity.set(1, 0, 0)
    const { engine } = createExactFixture({ dicePairs })

    engine.start()
    engine.beginSettle()
    runNextFrame(100)
    engine.stop()
    expect(engine.getDiagnostics()).toMatchObject({
      mode: 'stopped',
      physicsStepCount: 4,
      physicsTiming: { terminalAbandoned: { reason: 'stopped' } },
    })

    engine.start()
    engine.beginSettle()
    runNextFrame(200)
    expect(engine.getDiagnostics().physicsStepCount).toBe(8)
    engine.dispose()
    expect(engine.getDiagnostics()).toMatchObject({
      mode: 'stopped',
      physicsStepCount: 8,
      physicsTiming: { terminalAbandoned: { reason: 'disposed' } },
    })
  })

  it('exact 重复 beginSettle 会拒绝，profile 开关不改变固定步轨迹', () => {
    const run = (profiled: boolean) => {
      const dicePairs = makeDicePairs(1, true)
      let profileClock = 0
      const { engine } = createExactFixture({
        variant: 'exact-cap6',
        dicePairs,
        performanceProfile: profiled
          ? {
              now: () => {
                profileClock += 0.1
                return profileClock
              },
            }
          : undefined,
      })
      engine.start()
      engine.beginSettle()
      expect(() => engine.beginSettle()).toThrow(/不能重复/)
      runNextFrame(100)
      const diagnostics = { ...engine.getDiagnostics() }
      delete diagnostics.performanceProfile
      return diagnostics
    }

    expect(run(true)).toEqual(run(false))
  })

  it('未显式启用 profile 时 rolling 不读取 performance.now', () => {
    const now = vi.spyOn(performance, 'now')
    const dicePairs = makeDicePairs()
    dicePairs[0].body.velocity.set(1, 0, 0)
    const { engine } = createFixture({ dicePairs })

    engine.start()
    engine.beginSettle()
    runNextFrame(1000)
    runNextFrame(1016.67)

    expect(now).not.toHaveBeenCalled()
  })

  it('profile 记录真实 stepnumber delta，并明确 post-render 快照排除当前 publish 帧', () => {
    const world = new CANNON.World()
    const dicePairs = makeDicePairs()
    dicePairs[0].body.velocity.set(1, 0, 0)
    let clock = 0
    const now = vi.fn(() => {
      clock += 0.25
      return clock
    })
    const published: RollingCpuProfileSnapshot[] = []
    const { engine } = createFixture({
      world,
      dicePairs,
      worldStep: (dt) => world.step(1 / 60, dt, 8),
      onDiagnostics: (diagnostics) => {
        if (diagnostics.performanceProfile) published.push(diagnostics.performanceProfile)
      },
      performanceProfile: { now, capacity: 4 },
    })

    engine.start()
    engine.beginSettle()
    runNextFrame(1000)
    runNextFrame(1050)

    const duringPublish = published.at(-1)
    expect(duringPublish).toMatchObject({
      totalFrameCount: 0,
      retainedFrameCount: 0,
      currentFrameExcluded: true,
    })

    const afterPublish = engine.getDiagnostics().performanceProfile
    expect(afterPublish).toMatchObject({
      totalFrameCount: 1,
      retainedFrameCount: 1,
      currentFrameExcluded: false,
      rendererTimingKind: 'cpu-submit',
    })
    expect(afterPublish?.metrics.cannonStepnumberDelta).toEqual({
      count: 1,
      p50: 3,
      p95: 3,
      max: 3,
    })
    for (const metric of ROLLING_CPU_PROFILE_METRICS) {
      const distribution = afterPublish?.metrics[metric]
      expect(distribution?.count).toBe(1)
      expect(distribution?.p50).toSatisfy(Number.isFinite)
      expect(distribution?.p95).toSatisfy(Number.isFinite)
      expect(distribution?.max).toSatisfy(Number.isFinite)
    }
    expect(now).toHaveBeenCalled()
  })

  it('启用 profile 不改变同一 rolling 轨迹的调度与结算结果', () => {
    const run = (profiled: boolean) => {
      const dicePairs = makeDicePairs(1, true)
      const onSettled = vi.fn()
      let clock = 0
      const { engine, sceneCtx } = createFixture({
        dicePairs,
        onSettled,
        performanceProfile: profiled
          ? {
              now: () => {
                clock += 0.1
                return clock
              },
            }
          : undefined,
      })
      engine.start()
      engine.beginSettle()
      runNextFrame(1000)
      runNextFrame(1016.67)
      const diagnostics = { ...engine.getDiagnostics() }
      delete diagnostics.performanceProfile
      return {
        diagnostics,
        renderCalls: sceneCtx.renderer.render.mock.calls.length,
        settleResult: onSettled.mock.calls[0]?.[0],
      }
    }

    expect(run(true)).toEqual(run(false))
  })

  it.each([false, true])('profile=%s 时最终 raw render 前都恢复 static DPR phase', (profiled) => {
    const dicePairs = makeDicePairs(1, true)
    let clock = 0
    const { engine, sceneCtx } = createFixture({
      dicePairs,
      performanceProfile: profiled
        ? {
            now: () => {
              clock += 0.1
              return clock
            },
          }
        : undefined,
    })

    engine.start()
    engine.beginSettle()
    expect(sceneCtx.setRenderPhase).toHaveBeenLastCalledWith('rolling')

    runNextFrame(1000)
    runNextFrame(1016.67)

    expect(engine.getDiagnostics().mode).toBe('settled')
    expect(sceneCtx.setRenderPhase).toHaveBeenLastCalledWith('static')
    const lastRenderOrder = sceneCtx.renderer.render.mock.invocationCallOrder.at(-1)!
    const lastStaticOrder = sceneCtx.setRenderPhase.mock.invocationCallOrder.at(-1)!
    expect(lastStaticOrder).toBeLessThan(lastRenderOrder)
  })

  function runNextFrame(timestamp: number): boolean {
    const next = pendingFrames.entries().next()
    if (next.done) return false

    const [id, callback] = next.value
    pendingFrames.delete(id)
    callback(timestamp)
    return true
  }

  it('start 只渲染首屏一帧，idle 不推进物理也不常驻 rAF', () => {
    const { engine, sceneCtx, worldStep, onSettled } = createFixture()

    expect(engine.getDiagnostics()).toEqual({
      mode: 'stopped',
      renderCount: 0,
      physicsStepCount: 0,
      frameScheduled: false,
      physicsTiming: ZERO_PHYSICS_TIMING,
      rollSafety: ZERO_ROLL_SAFETY,
      rollingShadow: ZERO_ROLLING_SHADOW,
    })

    engine.start()
    engine.start()
    expect(pendingFrames.size).toBe(1)
    expect(engine.getDiagnostics().frameScheduled).toBe(true)

    expect(runNextFrame(1000)).toBe(true)
    expect(worldStep).not.toHaveBeenCalled()
    expect(onSettled).not.toHaveBeenCalled()
    expect(sceneCtx.renderer.render).toHaveBeenCalledTimes(1)
    expect(sceneCtx.renderer.shadowMap.autoUpdate).toBe(false)
    expect(sceneCtx.renderer.shadowMap.needsUpdate).toBe(true)
    expect(engine.getDiagnostics()).toEqual({
      mode: 'idle',
      renderCount: 1,
      physicsStepCount: 0,
      frameScheduled: false,
      physicsTiming: ZERO_PHYSICS_TIMING,
      rollSafety: ZERO_ROLL_SAFETY,
      rollingShadow: ZERO_ROLLING_SHADOW,
    })

    expect(runNextFrame(2000)).toBe(false)
    expect(sceneCtx.renderer.render).toHaveBeenCalledTimes(1)
  })

  it('诊断订阅只在渲染完成后得到 post-render 快照', () => {
    const onDiagnostics = vi.fn()
    const { engine } = createFixture({ onDiagnostics })

    engine.start()
    expect(onDiagnostics).not.toHaveBeenCalled()

    runNextFrame(1000)
    expect(onDiagnostics).toHaveBeenCalledOnce()
    expect(onDiagnostics).toHaveBeenLastCalledWith({
      mode: 'idle',
      renderCount: 1,
      physicsStepCount: 0,
      frameScheduled: false,
      physicsTiming: ZERO_PHYSICS_TIMING,
      rollSafety: ZERO_ROLL_SAFETY,
      rollingShadow: ZERO_ROLLING_SHADOW,
    })

    engine.invalidate()
    expect(onDiagnostics).toHaveBeenCalledOnce()
    runNextFrame(1016)
    expect(onDiagnostics).toHaveBeenCalledTimes(2)
  })

  it('idle invalidate 合并为单帧，并使用 raw body 姿态', () => {
    const dicePairs = makeDicePairs()
    const { engine, sceneCtx, worldStep } = createFixture({ dicePairs })
    const [{ body, mesh }] = dicePairs

    engine.start()
    runNextFrame(1000)

    body.position.set(3, 4, 5)
    body.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 3)
    body.interpolatedPosition.set(30, 40, 50)
    body.interpolatedQuaternion.set(0, 0, 0, 1)
    const committedPositions: number[][] = []
    dicePairs[0].syncVisual = vi.fn(() => {
      committedPositions.push(mesh.position.toArray())
    })

    engine.invalidate()
    engine.invalidate()
    engine.invalidate()
    expect(pendingFrames.size).toBe(1)

    runNextFrame(1100)
    expect(worldStep).not.toHaveBeenCalled()
    expect(sceneCtx.renderer.render).toHaveBeenCalledTimes(2)
    expect(mesh.position.toArray()).toEqual([3, 4, 5])
    expect(mesh.quaternion.x).toBeCloseTo(body.quaternion.x, 6)
    expect(mesh.quaternion.y).toBeCloseTo(body.quaternion.y, 6)
    expect(mesh.quaternion.z).toBeCloseTo(body.quaternion.z, 6)
    expect(mesh.quaternion.w).toBeCloseTo(body.quaternion.w, 6)
    expect(dicePairs[0].syncVisual).toHaveBeenCalledOnce()
    expect(committedPositions).toEqual([[3, 4, 5]])
    expect(engine.getDiagnostics()).toMatchObject({
      mode: 'idle',
      renderCount: 2,
      physicsStepCount: 0,
      frameScheduled: false,
    })
  })

  it('每轮第一个 rolling timestamp 只建立基准，避免跨轮大 delta', () => {
    const dicePairs = makeDicePairs()
    dicePairs[0].body.velocity.set(1, 0, 0)
    dicePairs[0].body.angularVelocity.set(0, 1, 0)
    const worldStep = vi.fn()
    const { engine } = createFixture({ dicePairs, worldStep })

    engine.start()
    engine.beginSettle()
    expect(engine.getDiagnostics().mode).toBe('rolling')
    expect(pendingFrames.size).toBe(1)

    runNextFrame(5000)
    expect(worldStep).not.toHaveBeenCalled()
    expect(engine.getDiagnostics().physicsStepCount).toBe(0)
    expect(pendingFrames.size).toBe(1)

    runNextFrame(5016.67)
    expect(worldStep).toHaveBeenCalledTimes(1)
    expect(worldStep).toHaveBeenLastCalledWith(expect.closeTo(0.01667, 5))
    expect(engine.getDiagnostics().rollingShadow).toMatchObject({
      rollingRenderFrameCount: 2,
      rollingShadowUpdateRequestCount: 2,
    })

    // 重开一轮时，即使 timestamp 间隔很大，也必须重新建立基准。
    engine.beginSettle()
    runNextFrame(50_000)
    expect(worldStep).toHaveBeenCalledTimes(1)
    expect(engine.getDiagnostics().rollingShadow).toMatchObject({
      rollingRenderFrameCount: 1,
      rollingShadowUpdateRequestCount: 1,
    })

    runNextFrame(50_020)
    expect(worldStep).toHaveBeenCalledTimes(2)
    expect(worldStep).toHaveBeenLastCalledWith(expect.closeTo(0.02, 5))
  })

  it('逐步累计半径、escape guard 与非有限状态，结算后仍保留整轮安全包络', () => {
    const dicePairs = makeDicePairs(2)
    const worldStep = vi.fn(() => {
      dicePairs[0].body.position.set(0.8, 1, 0)
      dicePairs[0].body.velocity.set(0, 1, 0)
      dicePairs[1].body.angularVelocity.x = Number.NaN
    })
    const { engine } = createFixture({ dicePairs, worldStep, onDiagnostics: vi.fn() })

    engine.start()
    engine.beginSettle()
    runNextFrame(1000)
    runNextFrame(1016.67)

    expect(engine.getDiagnostics().rollSafety).toEqual({
      maxRadius: 0.8,
      containmentRadius: WALL_INNER_RADIUS,
      conservativeContainmentRadius: CONSERVATIVE_DICE_CENTER_RADIUS,
      conservativeBoundaryCrossings: 1,
      wallCenterCrossings: 0,
      maxContactPenetration: 0,
      escapeGuardInterventionCount: 1,
      nonFiniteBodyStateDetected: true,
    })
  })

  it('rolling 使用插值姿态，且 invalidate 不会额外安排帧', () => {
    const dicePairs = makeDicePairs()
    const [{ body, mesh }] = dicePairs
    body.velocity.set(1, 0, 0)
    body.angularVelocity.set(0, 1, 0)

    const interpolatedQuaternion = new CANNON.Quaternion()
    interpolatedQuaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2)
    const worldStep = vi.fn(() => {
      body.position.set(9, 8, 7)
      body.quaternion.set(0, 0, 0, 1)
      body.interpolatedPosition.set(1, 2, 3)
      body.interpolatedQuaternion.copy(interpolatedQuaternion)
      body.velocity.set(1, 0, 0)
      body.angularVelocity.set(0, 1, 0)
    })
    const committedPositions: number[][] = []
    dicePairs[0].syncVisual = vi.fn(() => {
      committedPositions.push(mesh.position.toArray())
    })
    const { engine, sceneCtx } = createFixture({ dicePairs, worldStep })

    engine.start()
    engine.beginSettle()
    engine.invalidate()
    engine.invalidate()
    expect(pendingFrames.size).toBe(1)

    runNextFrame(1000)
    expect(worldStep).not.toHaveBeenCalled()
    expect(pendingFrames.size).toBe(1)

    runNextFrame(1016.67)
    expect(worldStep).toHaveBeenCalledTimes(1)
    expect(mesh.position.toArray()).toEqual([1, 2, 3])
    expect(mesh.position.toArray()).not.toEqual([9, 8, 7])
    expect(mesh.quaternion.x).toBeCloseTo(interpolatedQuaternion.x, 6)
    expect(mesh.quaternion.y).toBeCloseTo(interpolatedQuaternion.y, 6)
    expect(mesh.quaternion.z).toBeCloseTo(interpolatedQuaternion.z, 6)
    expect(mesh.quaternion.w).toBeCloseTo(interpolatedQuaternion.w, 6)
    expect(committedPositions.at(-1)).toEqual([1, 2, 3])
    expect(sceneCtx.renderer.shadowMap.autoUpdate).toBe(false)
    expect(engine.getDiagnostics()).toMatchObject({
      mode: 'rolling',
      renderCount: 2,
      physicsStepCount: 1,
      frameScheduled: true,
    })
    expect(pendingFrames.size).toBe(1)
  })

  it.each<[RollingShadowPreset | undefined, RollingShadowPreset, boolean[], number, number]>([
    [undefined, 'every-frame', [true, true, true, true, true], 5, 0],
    ['every-frame', 'every-frame', [true, true, true, true, true], 5, 0],
    ['alternate', 'alternate', [true, false, true, false, true], 3, 1],
    ['frozen-after-first', 'frozen-after-first', [true, false, false, false, false], 1, 4],
  ])(
    'rolling shadow preset=%s 只按真实 render 帧请求刷新',
    (configuredPreset, expectedPreset, expectedRequests, requestCount, maxSkipped) => {
      const dicePairs = makeDicePairs()
      dicePairs[0].body.velocity.set(1, 0, 0)
      dicePairs[0].body.angularVelocity.set(0, 1, 0)
      const { engine, sceneCtx } = createFixture({
        dicePairs,
        rollingShadowPreset: configuredPreset,
      })
      const observedRequests: boolean[] = []
      sceneCtx.renderer.render.mockImplementation(() => {
        observedRequests.push(sceneCtx.renderer.shadowMap.needsUpdate)
        // Three.js 在完成 shadow pass 后会消费全局 needsUpdate。
        sceneCtx.renderer.shadowMap.needsUpdate = false
      })

      engine.start()
      runNextFrame(900)
      observedRequests.length = 0

      engine.beginSettle()
      for (const timestamp of [1000, 1016.67, 1033.34, 1050.01, 1066.68]) {
        runNextFrame(timestamp)
      }

      expect(observedRequests).toEqual(expectedRequests)
      expect(sceneCtx.renderer.shadowMap.autoUpdate).toBe(false)
      expect(engine.getDiagnostics().rollingShadow).toEqual({
        version: 1,
        preset: expectedPreset,
        rollingRenderFrameCount: expectedRequests.length,
        rollingShadowUpdateRequestCount: requestCount,
        maxConsecutiveRollingFramesWithoutShadowUpdateRequest: maxSkipped,
      })
    },
  )

  it('skip 帧保留 resize 等外部 needsUpdate 请求，但不冒充 rolling 策略请求', () => {
    const dicePairs = makeDicePairs()
    dicePairs[0].body.velocity.set(1, 0, 0)
    dicePairs[0].body.angularVelocity.set(0, 1, 0)
    const { engine, sceneCtx } = createFixture({
      dicePairs,
      rollingShadowPreset: 'alternate',
    })
    const observedRequests: boolean[] = []
    sceneCtx.renderer.render.mockImplementation(() => {
      observedRequests.push(sceneCtx.renderer.shadowMap.needsUpdate)
      sceneCtx.renderer.shadowMap.needsUpdate = false
    })

    engine.start()
    runNextFrame(900)
    observedRequests.length = 0
    engine.beginSettle()
    runNextFrame(1000)

    sceneCtx.renderer.shadowMap.needsUpdate = true
    runNextFrame(1016.67)

    expect(observedRequests).toEqual([true, true])
    expect(engine.getDiagnostics().rollingShadow).toMatchObject({
      rollingRenderFrameCount: 2,
      rollingShadowUpdateRequestCount: 1,
      maxConsecutiveRollingFramesWithoutShadowUpdateRequest: 1,
    })
  })

  it('settle 回调后以最终 raw 姿态渲染，并立即停止连续帧', () => {
    const dicePairs = makeDicePairs(1, true)
    const [{ body, mesh }] = dicePairs
    body.position.set(1, 1, 1)
    body.interpolatedPosition.set(10, 10, 10)

    const finalQuaternion = new CANNON.Quaternion()
    finalQuaternion.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI / 4)
    const onSettled = vi.fn(() => {
      // 模拟 controller 在回调中冻结并校正最终 raw body 姿态。
      body.position.set(4, 5, 6)
      body.quaternion.copy(finalQuaternion)
    })
    const worldStep = vi.fn(() => {
      body.interpolatedPosition.set(20, 20, 20)
      body.interpolatedQuaternion.set(0, 0, 0, 1)
    })
    const { engine, sceneCtx } = createFixture({ dicePairs, worldStep, onSettled })
    const shadowUpdateRequests: boolean[] = []
    sceneCtx.renderer.render.mockImplementation(() => {
      shadowUpdateRequests.push(sceneCtx.renderer.shadowMap.needsUpdate)
      sceneCtx.renderer.shadowMap.needsUpdate = false
    })

    engine.start()
    engine.beginSettle()
    runNextFrame(1000)
    runNextFrame(1016.67)

    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledWith({
      reason: 'natural-sleep',
      elapsed: expect.any(Number),
    })
    expect(mesh.position.toArray()).toEqual([4, 5, 6])
    expect(mesh.position.toArray()).not.toEqual([20, 20, 20])
    expect(mesh.quaternion.x).toBeCloseTo(finalQuaternion.x, 6)
    expect(mesh.quaternion.y).toBeCloseTo(finalQuaternion.y, 6)
    expect(mesh.quaternion.z).toBeCloseTo(finalQuaternion.z, 6)
    expect(mesh.quaternion.w).toBeCloseTo(finalQuaternion.w, 6)
    expect(sceneCtx.renderer.shadowMap.autoUpdate).toBe(false)
    expect(sceneCtx.renderer.shadowMap.needsUpdate).toBe(false)
    expect(shadowUpdateRequests).toEqual([true, true])
    expect(engine.getDiagnostics()).toEqual({
      mode: 'settled',
      renderCount: 2,
      physicsStepCount: 1,
      frameScheduled: false,
      physicsTiming: ZERO_PHYSICS_TIMING,
      rollSafety: {
        ...ZERO_ROLL_SAFETY,
      },
      rollingShadow: {
        ...ZERO_ROLLING_SHADOW,
        rollingRenderFrameCount: 1,
        rollingShadowUpdateRequestCount: 1,
      },
    })
    expect(pendingFrames.size).toBe(0)

    expect(runNextFrame(2000)).toBe(false)
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(sceneCtx.renderer.render).toHaveBeenCalledTimes(2)

    engine.invalidate()
    engine.invalidate()
    expect(pendingFrames.size).toBe(1)
    runNextFrame(2100)
    expect(worldStep).toHaveBeenCalledTimes(1)
    expect(sceneCtx.renderer.render).toHaveBeenCalledTimes(3)
    expect(engine.getDiagnostics().mode).toBe('settled')
  })

  it('stop 取消已安排帧，stopped 状态下 invalidate 无效', () => {
    const { engine, sceneCtx, worldStep } = createFixture()

    engine.start()
    engine.beginSettle()
    expect(pendingFrames.size).toBe(1)

    engine.stop()
    expect(pendingFrames.size).toBe(0)
    expect(engine.getDiagnostics()).toEqual({
      mode: 'stopped',
      renderCount: 0,
      physicsStepCount: 0,
      frameScheduled: false,
      physicsTiming: ZERO_PHYSICS_TIMING,
      rollSafety: ZERO_ROLL_SAFETY,
      rollingShadow: ZERO_ROLLING_SHADOW,
    })

    engine.invalidate()
    expect(pendingFrames.size).toBe(0)
    expect(runNextFrame(1000)).toBe(false)
    expect(worldStep).not.toHaveBeenCalled()
    expect(sceneCtx.renderer.render).not.toHaveBeenCalled()
  })

  it('stop 在已有 rolling render 后清空逐轮阴影调度诊断', () => {
    const { engine } = createFixture()

    engine.start()
    engine.beginSettle()
    runNextFrame(1000)
    runNextFrame(1016.67)

    expect(engine.getDiagnostics().rollingShadow).toMatchObject({
      rollingRenderFrameCount: 2,
      rollingShadowUpdateRequestCount: 2,
    })

    engine.stop()

    expect(engine.getDiagnostics()).toMatchObject({
      mode: 'stopped',
      frameScheduled: false,
      rollingShadow: ZERO_ROLLING_SHADOW,
    })
  })

  it('returnToIdle 从 settled 语义回到 idle，只安排静态帧', () => {
    const dicePairs = makeDicePairs(1, true)
    const { engine, worldStep } = createFixture({ dicePairs })

    engine.start()
    engine.beginSettle()
    runNextFrame(1000)
    runNextFrame(1016.67)
    expect(engine.getDiagnostics().mode).toBe('settled')

    engine.returnToIdle()
    expect(engine.getDiagnostics()).toMatchObject({
      mode: 'idle',
      physicsStepCount: 1,
      frameScheduled: true,
    })
    runNextFrame(1100)
    expect(worldStep).toHaveBeenCalledTimes(1)
    expect(engine.getDiagnostics()).toMatchObject({
      mode: 'idle',
      physicsStepCount: 1,
      frameScheduled: false,
    })
  })
})
