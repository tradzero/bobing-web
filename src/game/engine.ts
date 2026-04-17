import * as THREE from 'three'
import type * as CANNON from 'cannon-es'
import type { DicePair } from '@/dice/create'
import { checkSettled, createSettleState, type SettleState } from '@/dice/settle'
import { ESCAPE_Y } from '@/physics/bowl-body'
import { soundManager } from '@/audio/sound'
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
  const { sceneCtx, worldStep, dicePairs, onSettled } = opts
  const { scene, camera, renderer } = sceneCtx
  const timer = new THREE.Timer()
  let timerInitialized = false

  let rafId: number | null = null
  let settleState: SettleState | null = null
  let settled = false
  let elapsedTime = 0

  const bodies = dicePairs.map((p) => p.body)

  // 绑定碰撞音效事件
  for (const body of bodies) {
    body.addEventListener('collide', soundManager.handleCollision)
  }

  function tick(timestamp: number) {
    rafId = requestAnimationFrame(tick)

    // 首帧初始化：先调用一次 update 设置基准时间，跳过本帧物理
    // 避免 Timer 从 0 开始导致首帧 delta 为页面加载以来的全部时间
    if (!timerInitialized) {
      timer.update(timestamp)
      timerInitialized = true
      renderer.render(scene, camera)
      return
    }

    timer.update(timestamp)
    const dt = Math.min(timer.getDelta(), 0.1) // 限制最大 delta，防止切 tab 回来物理爆炸
    elapsedTime += dt

    // 1. 物理步进（settle 后停止，防止 ConvexPolyhedron-Heightfield 幽灵碰撞唤醒骰子）
    if (!settled) {
      worldStep(dt)

      // 2. 逃逸防护：骰子超过碗口高度且向上运动时反射速度，防止弹出
      for (const { body } of dicePairs) {
        if (body.position.y > ESCAPE_Y && body.velocity.y > 0) {
          body.velocity.y = -body.velocity.y * 0.3
        }
      }
    }

    // 3. body → mesh 同步
    for (const { mesh, body } of dicePairs) {
      mesh.position.set(body.position.x, body.position.y, body.position.z)
      mesh.quaternion.set(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w,
      )
    }

    // 4. 停稳检测
    if (settleState && !settled) {
      if (checkSettled(bodies, elapsedTime, settleState)) {
        settled = true
        onSettled()
      }
    }

    // 5. 渲染
    renderer.render(scene, camera)
  }

  function start() {
    if (rafId !== null) return
    rafId = requestAnimationFrame(tick)
  }

  function stop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function beginSettle() {
    settled = false
    settleState = createSettleState(elapsedTime)
  }

  function dispose() {
    stop()
    // 移除碰撞事件监听
    for (const body of bodies) {
      body.removeEventListener('collide', soundManager.handleCollision)
    }
    soundManager.dispose()
  }

  return { start, stop, dispose, beginSettle }
}
