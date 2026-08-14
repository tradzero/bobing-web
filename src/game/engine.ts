import type * as CANNON from 'cannon-es'
import { PHYSICS } from '@/config/physics'
import {
  PHYSICS_CADENCE_MAX_ACCEPTED_WALL_DELTA_MS,
  PHYSICS_CADENCE_OVERLOAD_HIGH_WATER_MS,
} from '@/config/physics-cadence'
import type { DicePair } from '@/dice/create'
import { checkSettled, createSettleState, type SettleResult, type SettleState } from '@/dice/settle'
import { applyEscapeGuard } from '@/physics/escape-guard'
import {
  copyBodyTransformToObject,
  interpolateBodyTransform,
  syncBodyInterpolationState,
} from '@/physics/body-transform'
import {
  CONSERVATIVE_DICE_CENTER_RADIUS,
  WALL_INNER_RADIUS,
  createRollFrameDiagnostics,
  sampleRollBodyDiagnostics,
  sampleRollFrameDiagnostics,
} from '@/physics/roll-diagnostics'
import {
  createRollStepSession,
  type RollStepSession,
  type RollStepSessionSnapshot,
} from '@/physics/roll-step-session'
import { soundManager } from '@/audio/sound'
import type { SceneContext } from '@/scene/setup'
import { createFixedStepAccumulator, type FixedStepAccumulator } from './fixed-step-accumulator'
import {
  DEFAULT_RUNTIME_PHYSICS_SCHEDULER_VARIANT_ID,
  getPhysicsSchedulerVariant,
  type PhysicsSchedulerVariant,
} from './physics-scheduler-experiment'
import type { RollError } from './roll-error'
import {
  createRollingCpuProfileAccumulator,
  type RollingCpuFrameSample,
  type RollingCpuProfileSnapshot,
} from './performance-profile'
import {
  createRollingShadowScheduler,
  type RollingShadowPreset,
  type RollingShadowScheduleDiagnostics,
} from './rolling-shadow'

export type EngineMode = 'idle' | 'rolling' | 'settled' | 'error' | 'stopped'

export interface EnginePhysicsTimingDiagnostics {
  version: PhysicsSchedulerVariant['version']
  preset: PhysicsSchedulerVariant['id']
  kind: PhysicsSchedulerVariant['kind']
  maxStepsPerFrame: number | null
  fixedStepMs: number
  simulationStep: number | null
  simulationTime: number | null
  totalRawWallDeltaMs: number
  totalAcceptedWallDeltaMs: number
  totalPausedWallDeltaMs: number
  totalDiscardedWallDeltaMs: number
  totalExecutedSteps: number
  queuedMs: number
  queuedWholeSteps: number
  interpolationAlpha: number
  overload: {
    active: boolean
    highWaterMs: number
  }
  terminalAbandoned: {
    reason: 'settled' | 'timeout' | 'timing-overload' | 'stopped' | 'disposed'
    queuedMs: number
    queuedWholeSteps: number
    interpolationAlpha: number
  } | null
  suspended: boolean
}

export interface EngineDiagnostics {
  mode: EngineMode
  renderCount: number
  physicsStepCount: number
  frameScheduled: boolean
  physicsTiming: EnginePhysicsTimingDiagnostics
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
  /** rolling 阴影调度请求；计数只说明引擎发出请求，不表示 GPU 已完成 shadow pass。 */
  rollingShadow: RollingShadowScheduleDiagnostics
  /** 仅显式 e2e perf-profile 模式存在；字段同时包含 rAF 间隔、Cannon 子步数与主线程 CPU 耗时。 */
  performanceProfile?: RollingCpuProfileSnapshot
}

export interface EngineOptions {
  sceneCtx: SceneContext
  world: CANNON.World
  /** legacy-batched 对照/回滚入口；生产默认 exact 调度不会调用。 */
  worldStep: (dt: number) => void
  /** 生产默认 exact 调度的单固定步入口；不让 Cannon 自行累计墙钟时间。 */
  stepExact?: () => void
  dicePairs: DicePair[]
  onSettled: (result: SettleResult) => void
  onRollError?: (error: RollError) => void
  physicsSchedulerVariant?: Readonly<PhysicsSchedulerVariant>
  /** 用于 beginSettle/visibility 事件建立墙钟基准；不参与物理真值。 */
  clock?: () => number
  initiallyHidden?: boolean
  /** 可选只读诊断订阅，用于开发环境/浏览器验收，不参与状态决策。 */
  onDiagnostics?: (diagnostics: EngineDiagnostics) => void
  /** rolling 阴影刷新节奏；默认保持当前每个 rolling render 都请求刷新。 */
  rollingShadowPreset?: RollingShadowPreset
  /** 仅供隔离 e2e 性能采样；普通开发与生产不得传入。 */
  performanceProfile?: {
    now: () => number
    capacity?: number
  }
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
  /** 页面生命周期由调用方显式注入，避免 hidden 墙钟污染物理 backlog。 */
  setPageVisibility?: (hidden: boolean, timestampMs: number) => void
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
  const {
    sceneCtx,
    world,
    worldStep,
    stepExact,
    dicePairs,
    onSettled,
    onRollError,
    onDiagnostics,
    rollingShadowPreset,
    performanceProfile,
  } = opts
  const physicsSchedulerVariant =
    opts.physicsSchedulerVariant ??
    getPhysicsSchedulerVariant(DEFAULT_RUNTIME_PHYSICS_SCHEDULER_VARIANT_ID)
  const exactScheduler = physicsSchedulerVariant.kind === 'exact-accumulator'
  if (exactScheduler && !stepExact) {
    throw new Error(`physics scheduler ${physicsSchedulerVariant.id} 必须提供 stepExact`)
  }
  if (exactScheduler && !onRollError) {
    throw new Error(`physics scheduler ${physicsSchedulerVariant.id} 必须提供 onRollError`)
  }
  const clock = opts.clock ?? (() => performance.now())
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
  let suspended = opts.initiallyHidden ?? false
  let hiddenSinceTimestamp: number | null = null
  let exactAccumulator: FixedStepAccumulator | null = null
  let exactSession: RollStepSession | null = null
  let exactLastSessionSnapshot: RollStepSessionSnapshot | null = null
  let exactTerminalAbandoned: EnginePhysicsTimingDiagnostics['terminalAbandoned'] = null
  let exactProfileSample: RollingCpuFrameSample | null = null
  let rollFrameDiagnostics = createRollFrameDiagnostics()
  let rollEscapeGuardInterventionCount = 0
  const rollSafetyEnabled = onDiagnostics !== undefined
  const rollingCpuProfile = performanceProfile
    ? createRollingCpuProfileAccumulator(performanceProfile.capacity)
    : null
  const profileNow = performanceProfile?.now
  let profileFrameInProgress = false
  const rollingShadowScheduler = createRollingShadowScheduler(rollingShadowPreset)

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
    // 必须与真实 rolling renderer.render() 一一对应，不能在 tick/beginSettle 中预调用。
    const requestUpdate = rollingShadowScheduler.requestForRollingRender()
    const shadowMap = getShadowMap()
    if (!shadowMap) return
    shadowMap.autoUpdate = false
    // resize 等外部失效请求优先保留；策略只能增加请求，不能把它清掉。
    shadowMap.needsUpdate ||= requestUpdate
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

  function interpolateExactBodies(alpha: number): void {
    for (const { body } of dicePairs) interpolateBodyTransform(body, alpha)
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
    sceneCtx.setRenderPhase?.('static')
    prepareStaticShadows()
    syncRawBodies()
    renderer.render(scene, camera)
    renderCount++
  }

  function renderRollingFrame(): void {
    sceneCtx.setRenderPhase?.('rolling')
    prepareRollingShadows()
    syncInterpolatedBodies()
    renderer.render(scene, camera)
    renderCount++
  }

  function scheduleFrame(): void {
    if (disposed || suspended || rafId !== null || mode === 'stopped') return
    rafId = requestAnimationFrame(tick)
  }

  function notifyPostRenderDiagnostics(): void {
    onDiagnostics?.(getDiagnostics())
  }

  function measureCpu(action: () => void): number {
    const startedAt = profileNow!()
    action()
    return profileNow!() - startedAt
  }

  function measureExactPhase(
    metric:
      | 'worldStepCpuMs'
      | 'guardCpuMs'
      | 'rollSafetyCpuMs'
      | 'settleCpuMs'
      | 'transformSyncCpuMs'
      | 'rendererSubmitCpuMs'
      | 'diagnosticsPublishCpuMs',
    action: () => void,
  ): void {
    if (!exactProfileSample) {
      action()
      return
    }
    exactProfileSample[metric] += measureCpu(action)
  }

  function recordProfiledRollingFrame(rawDeltaMs: number, clampedDeltaMs: number): void {
    const tickStartedAt = profileNow!()
    const sample: RollingCpuFrameSample = {
      rafRawDeltaMs: rawDeltaMs,
      rafClampedDeltaMs: clampedDeltaMs,
      cannonStepnumberDelta: 0,
      worldStepCpuMs: 0,
      guardCpuMs: 0,
      rollSafetyCpuMs: 0,
      settleCpuMs: 0,
      transformSyncCpuMs: 0,
      rendererSubmitCpuMs: 0,
      diagnosticsPublishCpuMs: 0,
      tickTotalCpuMs: 0,
    }

    const stepnumberBefore = world.stepnumber
    sample.worldStepCpuMs = measureCpu(() => worldStep(clampedDeltaMs / 1000))
    sample.cannonStepnumberDelta = world.stepnumber - stepnumberBefore
    physicsStepCount++

    sample.guardCpuMs = measureCpu(() => {
      for (const body of bodies) {
        if (applyEscapeGuard(body) && rollSafetyEnabled) rollEscapeGuardInterventionCount++
      }
    })
    sample.rollSafetyCpuMs = measureCpu(observeRollSafety)

    let settleResult: SettleResult | null = null
    sample.settleCpuMs = measureCpu(() => {
      settleResult = settleState ? checkSettled(bodies, rollingElapsed, settleState, world) : null
    })

    if (settleResult) {
      mode = 'settled'
      settleState = null
      previousRollingTimestamp = null
      onSettled(settleResult)
      sceneCtx.setRenderPhase?.('static')
      prepareStaticShadows()
      sample.transformSyncCpuMs = measureCpu(syncRawBodies)
      sample.rendererSubmitCpuMs = measureCpu(() => renderer.render(scene, camera))
      renderCount++
    } else {
      prepareRollingShadows()
      sample.transformSyncCpuMs = measureCpu(syncInterpolatedBodies)
      sample.rendererSubmitCpuMs = measureCpu(() => renderer.render(scene, camera))
      renderCount++
      scheduleFrame()
    }

    // 此时当前帧尚未 record，发布出去的快照会明确标记为 excluded。
    profileFrameInProgress = true
    sample.diagnosticsPublishCpuMs = measureCpu(notifyPostRenderDiagnostics)
    sample.tickTotalCpuMs = profileNow!() - tickStartedAt
    rollingCpuProfile!.record(sample)
    profileFrameInProgress = false
  }

  function exactSessionSnapshot(): RollStepSessionSnapshot | null {
    return exactSession?.snapshot() ?? exactLastSessionSnapshot
  }

  function saveTerminalAbandoned(
    reason: NonNullable<EnginePhysicsTimingDiagnostics['terminalAbandoned']>['reason'],
  ): void {
    if (!exactAccumulator) return
    const timing = exactAccumulator.snapshot()
    exactTerminalAbandoned = {
      reason,
      queuedMs: timing.queuedMs,
      queuedWholeSteps: timing.queuedWholeSteps,
      interpolationAlpha: timing.interpolationAlpha,
    }
  }

  function finishExactSession(): RollStepSessionSnapshot | null {
    if (!exactSession) return exactLastSessionSnapshot
    exactLastSessionSnapshot = exactSession.finish()
    exactSession = null
    return exactLastSessionSnapshot
  }

  function renderExactRollingFrame(alpha: number): void {
    sceneCtx.setRenderPhase?.('rolling')
    prepareRollingShadows()
    measureExactPhase('transformSyncCpuMs', () => {
      interpolateExactBodies(alpha)
      syncInterpolatedBodies()
    })
    measureExactPhase('rendererSubmitCpuMs', () => renderer.render(scene, camera))
    renderCount++
  }

  function renderExactStaticFrame(): void {
    sceneCtx.setRenderPhase?.('static')
    prepareStaticShadows()
    measureExactPhase('transformSyncCpuMs', syncRawBodies)
    measureExactPhase('rendererSubmitCpuMs', () => renderer.render(scene, camera))
    renderCount++
  }

  function publishExactPostRenderDiagnostics(): void {
    measureExactPhase('diagnosticsPublishCpuMs', notifyPostRenderDiagnostics)
  }

  /**
   * exact scheduler 的唯一逐帧入口。frame plan 只负责时间守恒；每个真实物理步的
   * 安全采样、guard 与 settle 顺序全部委托给 roll-step session。
   */
  function processExactFrame(rawDeltaMs: number, renderAfter: boolean): void {
    if (
      !exactAccumulator ||
      !exactSession ||
      physicsSchedulerVariant.kind !== 'exact-accumulator'
    ) {
      throw new Error('exact scheduler 尚未初始化')
    }

    const plan = exactAccumulator.planFrame({
      rawWallDeltaMs: Math.max(rawDeltaMs, 0),
      paused: false,
      maxSteps: physicsSchedulerVariant.maxStepsPerFrame,
    })
    let settlement: SettleResult | null = null

    for (let step = 0; step < plan.maxExecutableSteps; step++) {
      const advance = exactSession.advanceExactStep()
      // 只在 exact step 连同逐步观察全部成功后扣减 backlog。
      exactAccumulator.consumeStep()
      physicsStepCount++
      if (advance.settled) {
        settlement = advance.settled
        break
      }
    }

    const frame = exactAccumulator.finishFrame()

    if (plan.overload.active) {
      saveTerminalAbandoned('timing-overload')
      const session = finishExactSession()
      mode = 'error'
      previousRollingTimestamp = null
      onRollError!({
        reason: 'timing-overload',
        simulationElapsed: session?.simulationTime ?? 0,
        queuedMs: frame.queuedMs,
        highWaterMs: plan.overload.highWaterMs,
        executedSteps: session?.simulationStep ?? 0,
      })
      if (renderAfter) {
        renderExactStaticFrame()
        publishExactPostRenderDiagnostics()
      }
      return
    }

    if (settlement) {
      const timedOut = settlement.reason === 'timeout'
      saveTerminalAbandoned(timedOut ? 'timeout' : 'settled')
      finishExactSession()
      mode = timedOut ? 'error' : 'settled'
      previousRollingTimestamp = null
      if (timedOut) onRollError!({ reason: 'timeout', elapsed: settlement.elapsed })
      else onSettled(settlement)
      if (renderAfter) {
        renderExactStaticFrame()
        publishExactPostRenderDiagnostics()
      }
      return
    }

    if (renderAfter) {
      renderExactRollingFrame(frame.interpolationAlpha)
      scheduleFrame()
      publishExactPostRenderDiagnostics()
    }
  }

  function recordProfiledExactFrame(rawDeltaMs: number): void {
    const tickStartedAt = profileNow!()
    const stepnumberBefore = world.stepnumber
    exactProfileSample = {
      rafRawDeltaMs: rawDeltaMs,
      rafClampedDeltaMs: Math.min(
        Math.max(rawDeltaMs, 0),
        PHYSICS_CADENCE_MAX_ACCEPTED_WALL_DELTA_MS,
      ),
      cannonStepnumberDelta: 0,
      worldStepCpuMs: 0,
      guardCpuMs: 0,
      rollSafetyCpuMs: 0,
      settleCpuMs: 0,
      transformSyncCpuMs: 0,
      rendererSubmitCpuMs: 0,
      diagnosticsPublishCpuMs: 0,
      tickTotalCpuMs: 0,
    }
    profileFrameInProgress = true
    try {
      processExactFrame(rawDeltaMs, true)
      exactProfileSample.cannonStepnumberDelta = world.stepnumber - stepnumberBefore
      exactProfileSample.tickTotalCpuMs = profileNow!() - tickStartedAt
      rollingCpuProfile!.record(exactProfileSample)
    } finally {
      exactProfileSample = null
      profileFrameInProgress = false
    }
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

    if (exactScheduler) {
      const previous = previousRollingTimestamp ?? timestamp
      // rAF 与 visibility 都应来自同一 monotonic time origin；回退时不移动基准。
      const effectiveTimestamp = Math.max(timestamp, previous)
      previousRollingTimestamp = effectiveTimestamp
      const rawDeltaMs = effectiveTimestamp - previous
      if (rollingCpuProfile) recordProfiledExactFrame(rawDeltaMs)
      else processExactFrame(rawDeltaMs, true)
      return
    }

    // 每轮第一个 timestamp 只建立基准，避免首屏等待或跨轮间隔形成大 delta。
    if (previousRollingTimestamp === null) {
      previousRollingTimestamp = timestamp
      renderRollingFrame()
      scheduleFrame()
      notifyPostRenderDiagnostics()
      return
    }

    const rawDeltaMs = timestamp - previousRollingTimestamp
    const dt = Math.min(Math.max(rawDeltaMs / 1000, 0), 0.1)
    previousRollingTimestamp = timestamp
    rollingElapsed += dt

    if (rollingCpuProfile) {
      recordProfiledRollingFrame(rawDeltaMs, dt * 1000)
      return
    }

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
    stopInternal('stopped')
  }

  function stopInternal(reason: 'stopped' | 'disposed'): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (exactScheduler && mode === 'rolling') {
      saveTerminalAbandoned(reason)
      finishExactSession()
    }
    mode = 'stopped'
    settleState = null
    previousRollingTimestamp = null
    rollingShadowScheduler.reset()
    sceneCtx.setRenderPhase?.('static')
  }

  function beginSettle(): void {
    if (disposed) return
    if (exactScheduler && mode === 'rolling') {
      throw new Error('exact scheduler 已在 rolling，不能重复 beginSettle')
    }

    mode = 'rolling'
    rollingElapsed = 0
    previousRollingTimestamp = null
    settleState = exactScheduler ? null : createSettleState(0)
    resetRollSafety()
    rollingCpuProfile?.reset()
    rollingShadowScheduler.reset()
    observeInitialRollSafety()
    sceneCtx.setRenderPhase?.('rolling')

    // throwDice 已更新 raw body；先初始化插值字段，避免首个基准帧显示上一轮姿态。
    for (const body of bodies) syncBodyInterpolationState(body)

    if (exactScheduler) {
      exactAccumulator = createFixedStepAccumulator({
        fixedStepMs: PHYSICS.fixedTimeStep * 1000,
        maxAcceptedWallDeltaMs: PHYSICS_CADENCE_MAX_ACCEPTED_WALL_DELTA_MS,
        overloadHighWaterMs: PHYSICS_CADENCE_OVERLOAD_HIGH_WATER_MS,
      })
      exactLastSessionSnapshot = null
      exactTerminalAbandoned = null
      exactSession = createRollStepSession({
        world,
        bodies,
        stepExact: stepExact!,
        settlementPolicy: 'runtime',
        runPhase: rollingCpuProfile
          ? (phase, action) => {
              const metric =
                phase === 'world-step'
                  ? 'worldStepCpuMs'
                  : phase === 'roll-safety'
                    ? 'rollSafetyCpuMs'
                    : phase === 'escape-guard'
                      ? 'guardCpuMs'
                      : phase === 'settle'
                        ? 'settleCpuMs'
                        : null
              if (metric) measureExactPhase(metric, action)
              else action()
            }
          : undefined,
      })
      const startedAt = clock()
      previousRollingTimestamp = suspended ? null : startedAt
      hiddenSinceTimestamp = suspended ? startedAt : null
    }

    scheduleFrame()
  }

  function returnToIdle(): void {
    if (disposed) return
    if (exactScheduler && mode === 'rolling') return

    mode = 'idle'
    rollingElapsed = 0
    previousRollingTimestamp = null
    settleState = null
    exactAccumulator = null
    exactSession = null
    exactLastSessionSnapshot = null
    exactTerminalAbandoned = null
    resetRollSafety()
    rollingCpuProfile?.reset()
    rollingShadowScheduler.reset()
    sceneCtx.setRenderPhase?.('static')
    prepareStaticShadows()
    scheduleFrame()
  }

  function invalidate(): void {
    if (disposed || mode === 'stopped' || mode === 'rolling') return
    scheduleFrame()
  }

  function setPageVisibility(hidden: boolean, timestampMs: number): void {
    if (!Number.isFinite(timestampMs)) {
      throw new RangeError(`visibility timestamp 必须是有限数字，收到 ${timestampMs}`)
    }
    if (disposed || hidden === suspended) return

    if (hidden) {
      const effectiveTimestamp =
        mode === 'rolling' && previousRollingTimestamp !== null
          ? Math.max(timestampMs, previousRollingTimestamp)
          : timestampMs
      const visibleTailMs =
        mode === 'rolling' && previousRollingTimestamp !== null
          ? effectiveTimestamp - previousRollingTimestamp
          : null
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      suspended = true
      hiddenSinceTimestamp = effectiveTimestamp

      // hide 事件发生前的尾段仍属于可见墙钟；只推进物理，不提交 rolling render。
      if (
        exactScheduler &&
        visibleTailMs !== null &&
        visibleTailMs > 0 &&
        exactAccumulator &&
        exactSession
      ) {
        previousRollingTimestamp = effectiveTimestamp
        processExactFrame(visibleTailMs, false)
      }
      previousRollingTimestamp = null
      return
    }

    const resumeTimestamp =
      hiddenSinceTimestamp === null ? timestampMs : Math.max(timestampMs, hiddenSinceTimestamp)

    if (exactScheduler && mode === 'rolling' && exactAccumulator && hiddenSinceTimestamp !== null) {
      const pausedMs = resumeTimestamp - hiddenSinceTimestamp
      exactAccumulator.planFrame({ rawWallDeltaMs: pausedMs, paused: true, maxSteps: 0 })
      exactAccumulator.finishFrame()
    }

    suspended = false
    hiddenSinceTimestamp = null
    // exact 从 resume timestamp 开始接纳新墙钟；legacy 保持首帧只重建基准的旧语义。
    previousRollingTimestamp = exactScheduler && mode === 'rolling' ? resumeTimestamp : null
    scheduleFrame()
  }

  function getDiagnostics(): EngineDiagnostics {
    const exactTiming = exactAccumulator?.snapshot()
    const exactRoll = exactSessionSnapshot()
    const physicsTiming: EnginePhysicsTimingDiagnostics = exactScheduler
      ? {
          version: physicsSchedulerVariant.version,
          preset: physicsSchedulerVariant.id,
          kind: physicsSchedulerVariant.kind,
          maxStepsPerFrame: physicsSchedulerVariant.maxStepsPerFrame,
          fixedStepMs: PHYSICS.fixedTimeStep * 1000,
          simulationStep: exactRoll?.simulationStep ?? null,
          simulationTime: exactRoll?.simulationTime ?? null,
          totalRawWallDeltaMs: exactTiming?.totalRawWallDeltaMs ?? 0,
          totalAcceptedWallDeltaMs: exactTiming?.totalAcceptedWallDeltaMs ?? 0,
          totalPausedWallDeltaMs: exactTiming?.totalPausedWallDeltaMs ?? 0,
          totalDiscardedWallDeltaMs: exactTiming?.totalDiscardedWallDeltaMs ?? 0,
          totalExecutedSteps: exactTiming?.totalExecutedSteps ?? 0,
          queuedMs: exactTiming?.queuedMs ?? 0,
          queuedWholeSteps: exactTiming?.queuedWholeSteps ?? 0,
          interpolationAlpha: exactTiming?.interpolationAlpha ?? 0,
          overload: exactTiming?.overload ?? {
            active: false,
            highWaterMs: PHYSICS_CADENCE_OVERLOAD_HIGH_WATER_MS,
          },
          terminalAbandoned: exactTerminalAbandoned,
          suspended,
        }
      : {
          version: physicsSchedulerVariant.version,
          preset: physicsSchedulerVariant.id,
          kind: physicsSchedulerVariant.kind,
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
          overload: { active: false, highWaterMs: PHYSICS_CADENCE_OVERLOAD_HIGH_WATER_MS },
          terminalAbandoned: null,
          suspended,
        }
    const diagnostics: EngineDiagnostics = {
      mode,
      renderCount,
      physicsStepCount,
      frameScheduled: rafId !== null,
      physicsTiming,
      rollSafety: {
        maxRadius: exactRoll?.maxRadius ?? rollFrameDiagnostics.maxRadius,
        containmentRadius: WALL_INNER_RADIUS,
        conservativeContainmentRadius: CONSERVATIVE_DICE_CENTER_RADIUS,
        conservativeBoundaryCrossings:
          exactRoll?.conservativeBoundaryCrossings ??
          rollFrameDiagnostics.conservativeBoundaryCrossings,
        wallCenterCrossings:
          exactRoll?.wallCenterCrossings ?? rollFrameDiagnostics.wallCenterCrossings,
        maxContactPenetration:
          exactRoll?.maxContactPenetration ?? rollFrameDiagnostics.maxContactPenetration,
        escapeGuardInterventionCount:
          exactRoll?.escapeGuardInterventionCount ?? rollEscapeGuardInterventionCount,
        nonFiniteBodyStateDetected: exactRoll?.nanDetected ?? rollFrameDiagnostics.nanDetected,
      },
      rollingShadow: rollingShadowScheduler.snapshot(),
    }
    if (rollingCpuProfile) {
      diagnostics.performanceProfile = rollingCpuProfile.snapshot(profileFrameInProgress)
    }
    return diagnostics
  }

  function dispose(): void {
    if (disposed) return
    stopInternal('disposed')
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
    setPageVisibility,
  }
}
