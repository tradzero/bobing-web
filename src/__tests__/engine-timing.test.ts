// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as CANNON from 'cannon-es'
import { createEngine } from '@/game/engine'
import type { SceneContext } from '@/scene/setup'
import type { DicePair } from '@/dice/create'
import * as THREE from 'three'

/**
 * Engine 时序集成测试
 * 验证 engine 作为唯一时钟源的关键语义：
 * - beginSettle 后停稳只触发一次 onSettled
 * - settled 后不重复回调
 * - body → mesh 同步每帧执行
 */

/** 创建 mock SceneContext（不需要真实 WebGL） */
function mockSceneCtx(): SceneContext {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  // jsdom 无 WebGL，用普通对象替代 renderer
  const renderer = {
    render: vi.fn(),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    dispose: vi.fn(),
    domElement: document.createElement('canvas'),
  } as unknown as THREE.WebGLRenderer
  return {
    scene,
    camera,
    renderer,
    handleResize: vi.fn(),
    dispose: vi.fn(),
  }
}

/** 创建 mock DicePair，body 已在 sleep 状态 */
function makeSleepingDicePairs(count = 6): DicePair[] {
  return Array.from({ length: count }, () => {
    const body = new CANNON.Body({ mass: 0.03, allowSleep: true })
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.02, 0.02, 0.02)))
    // 直接让 body sleep，模拟已停稳
    body.sleep()
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.04),
      new THREE.MeshBasicMaterial(),
    )
    return { body, mesh }
  })
}

describe('Engine 时序集成测试', () => {
  let rafCallbacks: ((timestamp: number) => void)[]
  let rafId: number

  beforeEach(() => {
    rafCallbacks = []
    rafId = 0
    // mock requestAnimationFrame：收集回调，手动驱动
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      rafCallbacks.push(cb)
      return ++rafId
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** 手动驱动帧 tick */
  function driveFrames(count: number, startMs = 1000, stepMs = 16.67) {
    for (let i = 0; i < count; i++) {
      const cbs = rafCallbacks.splice(0)
      for (const cb of cbs) {
        cb(startMs + i * stepMs)
      }
    }
  }

  it('beginSettle 后 onSettled 只触发一次', () => {
    const onSettled = vi.fn()
    const dicePairs = makeSleepingDicePairs()
    const sceneCtx = mockSceneCtx()

    const engine = createEngine({
      sceneCtx,
      world: new CANNON.World(),
      worldStep: vi.fn(),
      dicePairs,
      onSettled,
    })

    engine.start()
    engine.beginSettle()

    // 驱动足够帧数（首帧为初始化帧，第2帧开始真正执行）
    driveFrames(10)

    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('未调用 beginSettle 时不触发 onSettled', () => {
    const onSettled = vi.fn()
    const dicePairs = makeSleepingDicePairs()
    const sceneCtx = mockSceneCtx()

    const engine = createEngine({
      sceneCtx,
      world: new CANNON.World(),
      worldStep: vi.fn(),
      dicePairs,
      onSettled,
    })

    engine.start()
    // 不调用 beginSettle
    driveFrames(10)

    expect(onSettled).not.toHaveBeenCalled()
  })

  it('settled 后连续帧不重复回调', () => {
    const onSettled = vi.fn()
    const dicePairs = makeSleepingDicePairs()
    const sceneCtx = mockSceneCtx()

    const engine = createEngine({
      sceneCtx,
      world: new CANNON.World(),
      worldStep: vi.fn(),
      dicePairs,
      onSettled,
    })

    engine.start()
    engine.beginSettle()

    // 先驱动触发 settle
    driveFrames(5)
    expect(onSettled).toHaveBeenCalledTimes(1)

    // 再驱动更多帧，不应重复
    driveFrames(20, 2000)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('body → mesh 位置同步每帧执行', () => {
    const dicePairs = makeSleepingDicePairs(2)
    const sceneCtx = mockSceneCtx()

    // 给 body 设置已知位置
    dicePairs[0].body.position.set(1, 2, 3)
    dicePairs[1].body.position.set(4, 5, 6)

    const engine = createEngine({
      sceneCtx,
      world: new CANNON.World(),
      worldStep: vi.fn(),
      dicePairs,
      onSettled: vi.fn(),
    })

    engine.start()
    // 首帧为初始化帧（跳过物理），第2帧才同步
    driveFrames(3)

    expect(dicePairs[0].mesh.position.x).toBe(1)
    expect(dicePairs[0].mesh.position.y).toBe(2)
    expect(dicePairs[0].mesh.position.z).toBe(3)
    expect(dicePairs[1].mesh.position.x).toBe(4)
    expect(dicePairs[1].mesh.position.y).toBe(5)
    expect(dicePairs[1].mesh.position.z).toBe(6)
  })

  it('body → mesh 四元数同步每帧执行', () => {
    const dicePairs = makeSleepingDicePairs(1)
    const sceneCtx = mockSceneCtx()

    // 绕 Y 轴旋转 90°
    dicePairs[0].body.quaternion.setFromAxisAngle(
      new CANNON.Vec3(0, 1, 0),
      Math.PI / 2,
    )

    const engine = createEngine({
      sceneCtx,
      world: new CANNON.World(),
      worldStep: vi.fn(),
      dicePairs,
      onSettled: vi.fn(),
    })

    engine.start()
    driveFrames(3)

    const bq = dicePairs[0].body.quaternion
    const mq = dicePairs[0].mesh.quaternion
    expect(mq.x).toBeCloseTo(bq.x, 6)
    expect(mq.y).toBeCloseTo(bq.y, 6)
    expect(mq.z).toBeCloseTo(bq.z, 6)
    expect(mq.w).toBeCloseTo(bq.w, 6)
  })

  it('连续两轮 beginSettle 各只触发一次 onSettled', () => {
    const onSettled = vi.fn()
    const dicePairs = makeSleepingDicePairs()
    const sceneCtx = mockSceneCtx()

    const engine = createEngine({
      sceneCtx,
      world: new CANNON.World(),
      worldStep: vi.fn(),
      dicePairs,
      onSettled,
    })

    engine.start()

    // 第一轮
    engine.beginSettle()
    driveFrames(5)
    expect(onSettled).toHaveBeenCalledTimes(1)

    // 第二轮
    engine.beginSettle()
    driveFrames(5, 2000)
    expect(onSettled).toHaveBeenCalledTimes(2)

    // 之后不应再触发
    driveFrames(10, 3000)
    expect(onSettled).toHaveBeenCalledTimes(2)
  })
})
