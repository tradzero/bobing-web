export const FIXED_STEP_ACCUMULATOR_VERSION = 1
export const DEFAULT_MAX_ACCEPTED_WALL_DELTA_MS = 100

export interface FixedStepAccumulatorOptions {
  fixedStepMs: number
  overloadHighWaterMs: number
  maxAcceptedWallDeltaMs?: number
}

export interface FixedStepFrameInput {
  rawWallDeltaMs: number
  paused: boolean
  maxSteps: number
}

export interface FixedStepOverloadDiagnostics {
  active: boolean
  enteredThisFrame: boolean
  highWaterMs: number
}

export interface FixedStepQueueDiagnostics {
  queuedMs: number
  /** 含不足一个固定步的余量，例如 10ms / 16.67ms = 0.6。 */
  queuedSteps: number
  queuedWholeSteps: number
  /**
   * previous → raw 的渲染插值系数。只剩小数余量时取余量比例；仍欠完整步骤时
   * 饱和为 1，避免在追赶不足时把画面倒插回 previous pose。
   */
  interpolationAlpha: number
}

export interface FixedStepFramePlan extends FixedStepQueueDiagnostics {
  version: typeof FIXED_STEP_ACCUMULATOR_VERSION
  rawWallDeltaMs: number
  acceptedWallDeltaMs: number
  pausedWallDeltaMs: number
  discardedWallDeltaMs: number
  discardedByClampMs: number
  discardedByPauseMs: number
  discardedByOverloadMs: number
  availableSteps: number
  maxExecutableSteps: number
  overload: FixedStepOverloadDiagnostics
}

export interface FixedStepFrameResult extends FixedStepFramePlan {
  executedSteps: number
  executedSimulationMs: number
}

export interface FixedStepAccumulatorSnapshot extends FixedStepQueueDiagnostics {
  version: typeof FIXED_STEP_ACCUMULATOR_VERSION
  fixedStepMs: number
  maxAcceptedWallDeltaMs: number
  overload: Omit<FixedStepOverloadDiagnostics, 'enteredThisFrame'>
  totalFrameCount: number
  totalRawWallDeltaMs: number
  totalAcceptedWallDeltaMs: number
  totalPausedWallDeltaMs: number
  totalDiscardedWallDeltaMs: number
  totalExecutedSteps: number
  totalExecutedSimulationMs: number
  frameInProgress: boolean
}

export interface FixedStepAccumulator {
  planFrame: (input: FixedStepFrameInput) => FixedStepFramePlan
  /** 仅在一个固定物理步已经成功执行后调用；不会预扣尚未执行的计划步数。 */
  consumeStep: () => void
  finishFrame: () => FixedStepFrameResult
  snapshot: () => FixedStepAccumulatorSnapshot
  reset: () => void
}

interface MutableFrame {
  plan: FixedStepFramePlan
  executedSteps: number
}

function requireFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} 必须是有限非负数，收到 ${value}`)
  }
}

function requireFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} 必须是有限正数，收到 ${value}`)
  }
}

/**
 * 显式 fixed-step backlog 所有者。
 *
 * 可见帧只接纳至多 maxAcceptedWallDeltaMs，多余墙钟会记入 discarded；pause
 * 帧完全不接纳。backlog 越过高水位会锁存 overload：队列不会被清空，但后续也
 * 不再接纳或执行，交由上层进入明确的 timing-overload 流程。
 */
export function createFixedStepAccumulator(
  options: FixedStepAccumulatorOptions,
): FixedStepAccumulator {
  const maxAcceptedWallDeltaMs =
    options.maxAcceptedWallDeltaMs ?? DEFAULT_MAX_ACCEPTED_WALL_DELTA_MS
  requireFinitePositive(options.fixedStepMs, 'fixedStepMs')
  requireFinitePositive(options.overloadHighWaterMs, 'overloadHighWaterMs')
  requireFinitePositive(maxAcceptedWallDeltaMs, 'maxAcceptedWallDeltaMs')

  const fixedStepMs = options.fixedStepMs
  const overloadHighWaterMs = options.overloadHighWaterMs
  const epsilonMs = Math.max(Number.EPSILON * 16, fixedStepMs * 1e-10)

  let queuedMs = 0
  let overloadActive = false
  let totalFrameCount = 0
  let totalRawWallDeltaMs = 0
  let totalAcceptedWallDeltaMs = 0
  let totalPausedWallDeltaMs = 0
  let totalDiscardedWallDeltaMs = 0
  let totalExecutedSteps = 0
  let currentFrame: MutableFrame | null = null

  function normalizeQueue(): void {
    if (Math.abs(queuedMs) <= epsilonMs) queuedMs = 0
  }

  function queueDiagnostics(): FixedStepQueueDiagnostics {
    normalizeQueue()
    const queuedWholeSteps = Math.floor((queuedMs + epsilonMs) / fixedStepMs)
    const queuedSteps = queuedMs / fixedStepMs
    const fractionalQueueMs = Math.max(0, queuedMs - queuedWholeSteps * fixedStepMs)
    const rawInterpolationAlpha = fractionalQueueMs / fixedStepMs
    const interpolationAlpha =
      queuedWholeSteps > 0
        ? 1
        : rawInterpolationAlpha <= epsilonMs / fixedStepMs
          ? 0
          : Math.min(rawInterpolationAlpha, 1)
    return {
      queuedMs,
      queuedSteps: Math.abs(queuedSteps) <= Number.EPSILON * 16 ? 0 : queuedSteps,
      queuedWholeSteps,
      interpolationAlpha,
    }
  }

  function planFrame(input: FixedStepFrameInput): FixedStepFramePlan {
    if (currentFrame) throw new Error('上一帧尚未 finishFrame，不能创建新计划')
    requireFiniteNonNegative(input.rawWallDeltaMs, 'rawWallDeltaMs')
    if (typeof input.paused !== 'boolean') {
      throw new TypeError(`paused 必须是 boolean，收到 ${String(input.paused)}`)
    }
    if (!Number.isSafeInteger(input.maxSteps) || input.maxSteps < 0) {
      throw new RangeError(`maxSteps 必须是非负安全整数，收到 ${input.maxSteps}`)
    }

    const rawWallDeltaMs = input.rawWallDeltaMs
    let acceptedWallDeltaMs = 0
    let pausedWallDeltaMs = 0
    let discardedByClampMs = 0
    let discardedByPauseMs = 0
    let discardedByOverloadMs = 0

    if (input.paused) {
      pausedWallDeltaMs = rawWallDeltaMs
      discardedByPauseMs = rawWallDeltaMs
    } else if (overloadActive) {
      discardedByOverloadMs = rawWallDeltaMs
    } else {
      acceptedWallDeltaMs = Math.min(rawWallDeltaMs, maxAcceptedWallDeltaMs)
      discardedByClampMs = rawWallDeltaMs - acceptedWallDeltaMs
      queuedMs += acceptedWallDeltaMs
    }

    const enteredThisFrame = !overloadActive && queuedMs - overloadHighWaterMs > epsilonMs
    if (enteredThisFrame) overloadActive = true

    const discardedWallDeltaMs = discardedByClampMs + discardedByPauseMs + discardedByOverloadMs
    totalFrameCount++
    totalRawWallDeltaMs += rawWallDeltaMs
    totalAcceptedWallDeltaMs += acceptedWallDeltaMs
    totalPausedWallDeltaMs += pausedWallDeltaMs
    totalDiscardedWallDeltaMs += discardedWallDeltaMs

    const queue = queueDiagnostics()
    const availableSteps = queue.queuedWholeSteps
    const maxExecutableSteps =
      input.paused || overloadActive ? 0 : Math.min(availableSteps, input.maxSteps)
    const plan: FixedStepFramePlan = {
      version: FIXED_STEP_ACCUMULATOR_VERSION,
      rawWallDeltaMs,
      acceptedWallDeltaMs,
      pausedWallDeltaMs,
      discardedWallDeltaMs,
      discardedByClampMs,
      discardedByPauseMs,
      discardedByOverloadMs,
      availableSteps,
      maxExecutableSteps,
      ...queue,
      overload: {
        active: overloadActive,
        enteredThisFrame,
        highWaterMs: overloadHighWaterMs,
      },
    }
    currentFrame = { plan, executedSteps: 0 }
    return plan
  }

  function consumeStep(): void {
    if (!currentFrame) throw new Error('没有正在执行的 frame plan')
    if (currentFrame.executedSteps >= currentFrame.plan.maxExecutableSteps) {
      throw new RangeError('本帧已达到 maxExecutableSteps，不能继续 consumeStep')
    }
    queuedMs -= fixedStepMs
    normalizeQueue()
    if (queuedMs < 0) {
      throw new Error('fixed-step backlog 内部守恒失败：queuedMs 小于 0')
    }
    currentFrame.executedSteps++
    totalExecutedSteps++
  }

  function finishFrame(): FixedStepFrameResult {
    if (!currentFrame) throw new Error('没有正在执行的 frame plan')
    const { plan, executedSteps } = currentFrame
    currentFrame = null
    return {
      ...plan,
      ...queueDiagnostics(),
      executedSteps,
      executedSimulationMs: executedSteps * fixedStepMs,
    }
  }

  function snapshot(): FixedStepAccumulatorSnapshot {
    return {
      version: FIXED_STEP_ACCUMULATOR_VERSION,
      fixedStepMs,
      maxAcceptedWallDeltaMs,
      overload: { active: overloadActive, highWaterMs: overloadHighWaterMs },
      totalFrameCount,
      totalRawWallDeltaMs,
      totalAcceptedWallDeltaMs,
      totalPausedWallDeltaMs,
      totalDiscardedWallDeltaMs,
      totalExecutedSteps,
      totalExecutedSimulationMs: totalExecutedSteps * fixedStepMs,
      frameInProgress: currentFrame !== null,
      ...queueDiagnostics(),
    }
  }

  function reset(): void {
    queuedMs = 0
    overloadActive = false
    totalFrameCount = 0
    totalRawWallDeltaMs = 0
    totalAcceptedWallDeltaMs = 0
    totalPausedWallDeltaMs = 0
    totalDiscardedWallDeltaMs = 0
    totalExecutedSteps = 0
    currentFrame = null
  }

  return { planFrame, consumeStep, finishFrame, snapshot, reset }
}
