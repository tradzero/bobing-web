import * as THREE from 'three'
import type * as CANNON from 'cannon-es'
import type { DicePair } from '@/dice/create'
import { checkSettled, createSettleState, type SettleState } from '@/dice/settle'
import type { SceneContext } from '@/scene/setup'

export interface EngineOptions {
  sceneCtx: SceneContext
  world: CANNON.World
  worldStep: (dt: number) => void
  dicePairs: DicePair[]
  onSettled: () => void
}

export interface Engine {
  start: () => void
  stop: () => void
  dispose: () => void
  /** 开始新一轮停稳检测 */
  beginSettle: () => void
}

/**
 * 唯一 rAF 循环
 * 每帧顺序执行：物理步进 → body→mesh 同步 → 停稳检测 → 渲染
 */
export function createEngine(opts: EngineOptions): Engine {
  const { sceneCtx, world, worldStep, dicePairs, onSettled } = opts
  const { scene, camera, renderer } = sceneCtx
  const clock = new THREE.Clock(false)

  let rafId: number | null = null
  let settleState: SettleState | null = null
  let settled = false
  let elapsedTime = 0

  const bodies = dicePairs.map((p) => p.body)

  function tick() {
    rafId = requestAnimationFrame(tick)

    const dt = clock.getDelta()
    elapsedTime += dt

    // 1. 物理步进
    worldStep(dt)

    // 2. body → mesh 同步
    for (const { mesh, body } of dicePairs) {
      mesh.position.set(body.position.x, body.position.y, body.position.z)
      mesh.quaternion.set(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w,
      )
    }

    // 3. 停稳检测
    if (settleState && !settled) {
      if (checkSettled(bodies, elapsedTime, settleState)) {
        settled = true
        onSettled()
      }
    }

    // 4. 渲染
    renderer.render(scene, camera)
  }

  function start() {
    if (rafId !== null) return
    clock.start()
    tick()
  }

  function stop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    clock.stop()
  }

  function beginSettle() {
    settled = false
    settleState = createSettleState(elapsedTime)
  }

  function dispose() {
    stop()
  }

  return { start, stop, dispose, beginSettle }
}
