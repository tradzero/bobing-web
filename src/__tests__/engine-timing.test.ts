// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as CANNON from 'cannon-es'
import * as THREE from 'three'
import type { DicePair } from '@/dice/create'
import type { SettleResult } from '@/dice/settle'
import { createEngine, type Engine, type EngineDiagnostics } from '@/game/engine'
import type { SceneContext } from '@/scene/setup'
import { CONSERVATIVE_DICE_CENTER_RADIUS, WALL_INNER_RADIUS } from '@/physics/roll-diagnostics'

type MockSceneContext = SceneContext & {
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
    worldStep?: (dt: number) => void
    onSettled?: (result: SettleResult) => void
    onDiagnostics?: (diagnostics: EngineDiagnostics) => void
  }) {
    const sceneCtx = mockSceneCtx()
    const dicePairs = options?.dicePairs ?? makeDicePairs()
    const worldStep = options?.worldStep ?? vi.fn()
    const onSettled = options?.onSettled ?? vi.fn()
    const engine = createEngine({
      sceneCtx,
      world: new CANNON.World(),
      worldStep,
      dicePairs,
      onSettled,
      onDiagnostics: options?.onDiagnostics,
    })
    engines.push(engine)
    return { engine, sceneCtx, dicePairs, worldStep, onSettled }
  }

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
      rollSafety: ZERO_ROLL_SAFETY,
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
      rollSafety: ZERO_ROLL_SAFETY,
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
      rollSafety: ZERO_ROLL_SAFETY,
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

    // 重开一轮时，即使 timestamp 间隔很大，也必须重新建立基准。
    engine.beginSettle()
    runNextFrame(50_000)
    expect(worldStep).toHaveBeenCalledTimes(1)

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
    expect(sceneCtx.renderer.shadowMap.autoUpdate).toBe(true)
    expect(engine.getDiagnostics()).toMatchObject({
      mode: 'rolling',
      renderCount: 2,
      physicsStepCount: 1,
      frameScheduled: true,
    })
    expect(pendingFrames.size).toBe(1)
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
    expect(sceneCtx.renderer.shadowMap.needsUpdate).toBe(true)
    expect(engine.getDiagnostics()).toEqual({
      mode: 'settled',
      renderCount: 2,
      physicsStepCount: 1,
      frameScheduled: false,
      rollSafety: {
        ...ZERO_ROLL_SAFETY,
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
      rollSafety: ZERO_ROLL_SAFETY,
    })

    engine.invalidate()
    expect(pendingFrames.size).toBe(0)
    expect(runNextFrame(1000)).toBe(false)
    expect(worldStep).not.toHaveBeenCalled()
    expect(sceneCtx.renderer.render).not.toHaveBeenCalled()
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
