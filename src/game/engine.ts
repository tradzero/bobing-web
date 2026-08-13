import type * as CANNON from 'cannon-es'
import type { DicePair } from '@/dice/create'
import { checkSettled, createSettleState, type SettleResult, type SettleState } from '@/dice/settle'
import { applyEscapeGuard } from '@/physics/escape-guard'
import { copyBodyTransformToObject, syncBodyInterpolationState } from '@/physics/body-transform'
import {
  CONSERVATIVE_DICE_CENTER_RADIUS,
  WALL_INNER_RADIUS,
  createRollFrameDiagnostics,
  sampleRollBodyDiagnostics,
  sampleRollFrameDiagnostics,
} from '@/physics/roll-diagnostics'
import { soundManager } from '@/audio/sound'
import type { SceneContext } from '@/scene/setup'

export type EngineMode = 'idle' | 'rolling' | 'settled' | 'stopped'

export interface EngineDiagnostics {
  mode: EngineMode
  renderCount: number
  physicsStepCount: number
  frameScheduled: boolean
  /** 当前轮逐物理步累计的安全包络；用于发现飞出后落回或 guard 掩盖。 */
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

export interface EngineOptions {
  sceneCtx: SceneContext
  world: CANNON.World
  worldStep: (dt: number) => void
  dicePairs: DicePair[]
  onSettled: (result: SettleResult) => void
  /** 可选只读诊断订阅，用于开发环境/浏览器验收，不参与状态决策。 */
  onDiagnostics?: (diagnostics: EngineDiagnostics) => void
}

/** 引擎公共控制接口。测试替身也必须覆盖生命周期与诊断契约。 */
export interface Engine {
  start: () => void
  stop: () => void
  dispose: () => void
  /** 开始新一轮停稳检测 */
  beginSettle: () => void
  /** 游戏重置后回到 idle，并合并调度一帧静态画面。 */
  returnToIdle: () => void
  /** 非 rolling 阶段请求一次合并渲染；rolling 已有连续帧，无需额外调度。 */
  invalidate: () => void
  /** 获取不修改引擎状态的轻量诊断快照。 */
  getDiagnostics: () => EngineDiagnostics
}

type ShadowMapControls = {
  autoUpdate: boolean
  needsUpdate: boolean
}

/**
 * 按需调度的唯一渲染/物理循环。
 *
 * - idle / settled：只响应 start/invalidate 的单帧请求，不推进物理；
 * - rolling：连续 rAF，物理步进后使用 cannon-es 插值姿态渲染；
 * - 结算帧：先回调业务层冻结/提交，再同步 raw body 姿态渲染最后一帧。
 */
export function createEngine(opts: EngineOptions): Engine {
  const { sceneCtx, world, worldStep, dicePairs, onSettled, onDiagnostics } = opts
  const { scene, camera, renderer } = sceneCtx
  const bodies = dicePairs.map((pair) => pair.body)

  let mode: EngineMode = 'stopped'
  let rafId: number | null = null
  let settleState: SettleState | null = null
  let previousRollingTimestamp: number | null = null
  let rollingElapsed = 0
  let renderCount = 0
  let physicsStepCount = 0
  let disposed = false
  let rollFrameDiagnostics = createRollFrameDiagnostics()
  let rollEscapeGuardInterventionCount = 0
  const rollSafetyEnabled = onDiagnostics !== undefined

  for (const body of bodies) {
    body.addEventListener('collide', soundManager.handleCollision)
  }

  function getShadowMap(): ShadowMapControls | undefined {
    return (
      renderer as typeof renderer & {
        shadowMap?: ShadowMapControls
      }
    ).shadowMap
  }

  function prepareRollingShadows(): void {
    const shadowMap = getShadowMap()
    if (shadowMap) shadowMap.autoUpdate = true
  }

  function prepareStaticShadows(): void {
    const shadowMap = getShadowMap()
    if (!shadowMap) return
    shadowMap.autoUpdate = false
    shadowMap.needsUpdate = true
  }

  function syncRawBodies(): void {
    for (const { mesh, body, syncVisual } of dicePairs) {
      copyBodyTransformToObject(body, mesh, 'raw')
      syncVisual?.()
    }
  }

  function syncInterpolatedBodies(): void {
    for (const { mesh, body, syncVisual } of dicePairs) {
      copyBodyTransformToObject(body, mesh, 'interpolated')
      syncVisual?.()
    }
  }

  function resetRollSafety(): void {
    rollFrameDiagnostics = createRollFrameDiagnostics()
    rollEscapeGuardInterventionCount = 0
  }

  function observeRollSafety(): void {
    if (!rollSafetyEnabled) return
    sampleRollFrameDiagnostics(rollFrameDiagnostics, bodies, world)
  }

  function observeInitialRollSafety(): void {
    if (!rollSafetyEnabled) return
    // world.contacts 此刻仍可能属于上一轮；teleport 后只采新 body，不拼接陈旧 contact。
    sampleRollBodyDiagnostics(rollFrameDiagnostics, bodies)
  }

  function renderStaticFrame(): void {
    prepareStaticShadows()
    syncRawBodies()
    renderer.render(scene, camera)
    renderCount++
  }

  function renderRollingFrame(): void {
    prepareRollingShadows()
    syncInterpolatedBodies()
    renderer.render(scene, camera)
    renderCount++
  }

  function scheduleFrame(): void {
    if (disposed || rafId !== null || mode === 'stopped') return
    rafId = requestAnimationFrame(tick)
  }

  function notifyPostRenderDiagnostics(): void {
    onDiagnostics?.(getDiagnostics())
  }

  function tick(timestamp: number): void {
    // 当前回调已被消费；只有本帧末尾明确需要继续时才重新安排。
    rafId = null
    if (disposed || mode === 'stopped') return

    if (mode !== 'rolling') {
      renderStaticFrame()
      notifyPostRenderDiagnostics()
      return
    }

    prepareRollingShadows()

    // 每轮第一个 timestamp 只建立基准，避免首屏等待或跨轮间隔形成大 delta。
    if (previousRollingTimestamp === null) {
      previousRollingTimestamp = timestamp
      renderRollingFrame()
      scheduleFrame()
      notifyPostRenderDiagnostics()
      return
    }

    const dt = Math.min(Math.max((timestamp - previousRollingTimestamp) / 1000, 0), 0.1)
    previousRollingTimestamp = timestamp
    rollingElapsed += dt

    worldStep(dt)
    physicsStepCount++

    for (const body of bodies) {
      if (applyEscapeGuard(body) && rollSafetyEnabled) rollEscapeGuardInterventionCount++
    }
    observeRollSafety()

    const settleResult = settleState
      ? checkSettled(bodies, rollingElapsed, settleState, world)
      : null

    if (settleResult) {
      mode = 'settled'
      settleState = null
      previousRollingTimestamp = null

      // controller 会在回调中冻结刚体；最终画面必须反映回调后的 raw 姿态。
      onSettled(settleResult)
      renderStaticFrame()
      notifyPostRenderDiagnostics()
      return
    }

    renderRollingFrame()
    scheduleFrame()
    notifyPostRenderDiagnostics()
  }

  function start(): void {
    if (disposed) return
    if (mode === 'stopped') mode = 'idle'
    scheduleFrame()
  }

  function stop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    mode = 'stopped'
    settleState = null
    previousRollingTimestamp = null
  }

  function beginSettle(): void {
    if (disposed) return

    mode = 'rolling'
    rollingElapsed = 0
    previousRollingTimestamp = null
    settleState = createSettleState(0)
    resetRollSafety()
    observeInitialRollSafety()

    // throwDice 已更新 raw body；先初始化插值字段，避免首个基准帧显示上一轮姿态。
    for (const body of bodies) syncBodyInterpolationState(body)

    prepareRollingShadows()
    scheduleFrame()
  }

  function returnToIdle(): void {
    if (disposed) return

    mode = 'idle'
    rollingElapsed = 0
    previousRollingTimestamp = null
    settleState = null
    resetRollSafety()
    prepareStaticShadows()
    scheduleFrame()
  }

  function invalidate(): void {
    if (disposed || mode === 'stopped' || mode === 'rolling') return
    scheduleFrame()
  }

  function getDiagnostics(): EngineDiagnostics {
    return {
      mode,
      renderCount,
      physicsStepCount,
      frameScheduled: rafId !== null,
      rollSafety: {
        maxRadius: rollFrameDiagnostics.maxRadius,
        containmentRadius: WALL_INNER_RADIUS,
        conservativeContainmentRadius: CONSERVATIVE_DICE_CENTER_RADIUS,
        conservativeBoundaryCrossings: rollFrameDiagnostics.conservativeBoundaryCrossings,
        wallCenterCrossings: rollFrameDiagnostics.wallCenterCrossings,
        maxContactPenetration: rollFrameDiagnostics.maxContactPenetration,
        escapeGuardInterventionCount: rollEscapeGuardInterventionCount,
        nonFiniteBodyStateDetected: rollFrameDiagnostics.nanDetected,
      },
    }
  }

  function dispose(): void {
    if (disposed) return
    stop()
    disposed = true

    for (const body of bodies) {
      body.removeEventListener('collide', soundManager.handleCollision)
    }
    soundManager.dispose()
  }

  return {
    start,
    stop,
    dispose,
    beginSettle,
    returnToIdle,
    invalidate,
    getDiagnostics,
  }
}
