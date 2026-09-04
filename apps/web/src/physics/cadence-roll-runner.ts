import {
  PHYSICS_CADENCE_DEFAULT_MAX_RENDER_FRAMES,
  PHYSICS_CADENCE_FIXED_STEP_MS,
  PHYSICS_CADENCE_MAX_ACCEPTED_WALL_DELTA_MS,
  PHYSICS_CADENCE_OVERLOAD_HIGH_WATER_MS,
  getPhysicsCadence,
  getPhysicsCadenceFrame,
  getPhysicsCadenceScheduler,
  type PhysicsCadenceId,
  type PhysicsCadenceSchedulerId,
} from '@/config/physics-cadence'
import {
  createFixedStepAccumulator,
  type FixedStepAccumulatorSnapshot,
  type FixedStepFrameResult,
  type FixedStepQueueDiagnostics,
} from '@/game/fixed-step-accumulator'
import type { ThrowInitialStateDiagnostics } from '@/dice/throw-initial-state'
import type { ThrowDiagnostics } from '@/dice/throw'
import {
  createHeadlessRollSimulation,
  type HeadlessRollSimulationOptions,
  type RollRunResult,
} from '@dice/physics-core'
import type { RollStepSessionDiagnostics } from './roll-step-session'

/** cadence 报告字段或终止语义变化时必须递增。 */
export const CADENCE_ROLL_REPORT_SCHEMA_VERSION = 1
export const CADENCE_TIME_CONSERVATION_VERSION = 1

export interface CadenceRollOptions extends HeadlessRollSimulationOptions {
  cadence: PhysicsCadenceId
  scheduler: PhysicsCadenceSchedulerId
  /** cadence 帧耗尽仍未结算是显式硬失败，不会隐式追加 0ms drain。 */
  maxRenderFrames?: number
}

export interface CadenceRollFrameDiagnostics extends FixedStepFrameResult {
  /** driver 帧序号，从 1 开始。 */
  frameIndex: number
  /** 传给 versioned cadence definition 的索引，从 0 开始。 */
  cadenceFrameIndex: number
  queueBeforeMs: number
  settledAtSimulationStep: number | null
  /** 计划中尚未执行的步骤；settled 中断时成为 terminal abandoned backlog 的整步部分。 */
  unexecutedPlannedSteps: number
  terminalKind: 'settled' | 'timing-overload' | 'frame-budget-exhausted' | null
}

export interface CadenceAbandonedBacklog extends FixedStepQueueDiagnostics {
  /** terminal backlog 不会被悄悄归入 paused/clamp/overload discarded。 */
  countedAsDiscarded: false
}

export interface CadenceTimeConservationDiagnostics {
  version: typeof CADENCE_TIME_CONSERVATION_VERSION
  passed: true
  frameToleranceMs: number
  totalToleranceMs: number
  maxFrameRawBalanceErrorMs: number
  maxFrameDiscardBalanceErrorMs: number
  maxFrameQueueBalanceErrorMs: number
  totalRawBalanceErrorMs: number
  totalQueueBalanceErrorMs: number
}

interface CadenceRollReportBase {
  schemaVersion: typeof CADENCE_ROLL_REPORT_SCHEMA_VERSION
  seed: number
  cadence: {
    id: PhysicsCadenceId
    version: number
  }
  scheduler: {
    id: PhysicsCadenceSchedulerId
    version: number
    maxStepsPerFrame: number | null
  }
  initialState: ThrowInitialStateDiagnostics
  throwDiagnostics: ThrowDiagnostics
  frames: CadenceRollFrameDiagnostics[]
  timing: FixedStepAccumulatorSnapshot
  abandonedBacklog: CadenceAbandonedBacklog
  conservation: CadenceTimeConservationDiagnostics
}

export interface SettledCadenceRollReport extends CadenceRollReportBase {
  outcome: 'settled'
  roll: RollRunResult
  partialDiagnostics: null
}

export interface FailedCadenceRollReport extends CadenceRollReportBase {
  outcome: 'timing-overload' | 'frame-budget-exhausted'
  /** 调度异常不得伪装为一次可提交的正常 RollRunResult。 */
  roll: null
  partialDiagnostics: RollStepSessionDiagnostics
}

export type CadenceRollReport = SettledCadenceRollReport | FailedCadenceRollReport

interface ConservationAccumulator {
  maxFrameRawBalanceErrorMs: number
  maxFrameDiscardBalanceErrorMs: number
  maxFrameQueueBalanceErrorMs: number
}

function requirePositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} 必须是正安全整数，收到 ${value}`)
  }
}

function requireConserved(errorMs: number, toleranceMs: number, label: string): void {
  if (!Number.isFinite(errorMs) || errorMs > toleranceMs) {
    throw new Error(
      `cadence time conservation 失败：${label} error=${errorMs}ms，容差=${toleranceMs}ms`,
    )
  }
}

function absoluteBalance(left: number, right: number): number {
  return Math.abs(left - right)
}

function validateFrameConservation(
  frame: CadenceRollFrameDiagnostics,
  toleranceMs: number,
  accumulator: ConservationAccumulator,
): void {
  const rawBalanceErrorMs = absoluteBalance(
    frame.rawWallDeltaMs,
    frame.acceptedWallDeltaMs + frame.discardedWallDeltaMs,
  )
  const discardBalanceErrorMs = absoluteBalance(
    frame.discardedWallDeltaMs,
    frame.discardedByClampMs + frame.discardedByPauseMs + frame.discardedByOverloadMs,
  )
  const pauseClassificationErrorMs = absoluteBalance(
    frame.pausedWallDeltaMs,
    frame.discardedByPauseMs,
  )
  const queueBalanceErrorMs = absoluteBalance(
    frame.queueBeforeMs + frame.acceptedWallDeltaMs,
    frame.executedSimulationMs + frame.queuedMs,
  )

  requireConserved(rawBalanceErrorMs, toleranceMs, `frame ${frame.frameIndex} raw`)
  requireConserved(discardBalanceErrorMs, toleranceMs, `frame ${frame.frameIndex} discarded`)
  requireConserved(pauseClassificationErrorMs, toleranceMs, `frame ${frame.frameIndex} pause`)
  requireConserved(queueBalanceErrorMs, toleranceMs, `frame ${frame.frameIndex} queue`)
  if (frame.executedSteps > frame.maxExecutableSteps) {
    throw new Error(
      `cadence scheduler 失败：frame ${frame.frameIndex} 执行 ${frame.executedSteps} 步，` +
        `超过计划 ${frame.maxExecutableSteps} 步`,
    )
  }

  accumulator.maxFrameRawBalanceErrorMs = Math.max(
    accumulator.maxFrameRawBalanceErrorMs,
    rawBalanceErrorMs,
  )
  accumulator.maxFrameDiscardBalanceErrorMs = Math.max(
    accumulator.maxFrameDiscardBalanceErrorMs,
    discardBalanceErrorMs,
  )
  accumulator.maxFrameQueueBalanceErrorMs = Math.max(
    accumulator.maxFrameQueueBalanceErrorMs,
    queueBalanceErrorMs,
  )
}

function finishConservation(
  frames: readonly CadenceRollFrameDiagnostics[],
  timing: FixedStepAccumulatorSnapshot,
  frameConservation: ConservationAccumulator,
  frameToleranceMs: number,
  sessionSimulationStep: number,
  sessionSimulationTimeMs: number,
): CadenceTimeConservationDiagnostics {
  if (timing.frameInProgress) {
    throw new Error('cadence time conservation 失败：terminal snapshot 仍有未结束 frame')
  }

  const totalToleranceMs = Math.max(
    frameToleranceMs,
    timing.fixedStepMs * 1e-9 * (timing.totalFrameCount + timing.totalExecutedSteps + 1),
  )
  const totalRawBalanceErrorMs = absoluteBalance(
    timing.totalRawWallDeltaMs,
    timing.totalAcceptedWallDeltaMs + timing.totalDiscardedWallDeltaMs,
  )
  const totalQueueBalanceErrorMs = absoluteBalance(
    timing.totalAcceptedWallDeltaMs,
    timing.totalExecutedSimulationMs + timing.queuedMs,
  )
  requireConserved(totalRawBalanceErrorMs, totalToleranceMs, 'total raw')
  requireConserved(totalQueueBalanceErrorMs, totalToleranceMs, 'total queue')

  const sums = frames.reduce(
    (totals, frame) => ({
      raw: totals.raw + frame.rawWallDeltaMs,
      accepted: totals.accepted + frame.acceptedWallDeltaMs,
      paused: totals.paused + frame.pausedWallDeltaMs,
      discarded: totals.discarded + frame.discardedWallDeltaMs,
      executedSteps: totals.executedSteps + frame.executedSteps,
    }),
    { raw: 0, accepted: 0, paused: 0, discarded: 0, executedSteps: 0 },
  )
  const totalChecks: ReadonlyArray<readonly [string, number, number]> = [
    ['frame count', timing.totalFrameCount, frames.length],
    ['raw sum', timing.totalRawWallDeltaMs, sums.raw],
    ['accepted sum', timing.totalAcceptedWallDeltaMs, sums.accepted],
    ['paused sum', timing.totalPausedWallDeltaMs, sums.paused],
    ['discarded sum', timing.totalDiscardedWallDeltaMs, sums.discarded],
    ['executed step sum', timing.totalExecutedSteps, sums.executedSteps],
    [
      'executed simulation',
      timing.totalExecutedSimulationMs,
      timing.totalExecutedSteps * timing.fixedStepMs,
    ],
    ['accumulator/session step', timing.totalExecutedSteps, sessionSimulationStep],
    [
      'accumulator/session simulation time',
      timing.totalExecutedSimulationMs,
      sessionSimulationTimeMs,
    ],
  ]
  for (const [label, actual, expected] of totalChecks) {
    requireConserved(absoluteBalance(actual, expected), totalToleranceMs, label)
  }

  return {
    version: CADENCE_TIME_CONSERVATION_VERSION,
    passed: true,
    frameToleranceMs,
    totalToleranceMs,
    ...frameConservation,
    totalRawBalanceErrorMs,
    totalQueueBalanceErrorMs,
  }
}

/**
 * 使用 versioned wall-cadence 驱动唯一的 headless exact-step lifecycle。
 * cadence 只控制接纳/排队/每帧执行上限，物理单步的安全与 settle 顺序仍由 session 独占。
 */
export function runCadenceRoll(options: CadenceRollOptions): CadenceRollReport {
  const maxRenderFrames = options.maxRenderFrames ?? PHYSICS_CADENCE_DEFAULT_MAX_RENDER_FRAMES
  requirePositiveSafeInteger(maxRenderFrames, 'maxRenderFrames')

  const cadence = getPhysicsCadence(options.cadence)
  const scheduler = getPhysicsCadenceScheduler(options.scheduler)
  const maxSteps = scheduler.maxStepsPerFrame ?? Number.MAX_SAFE_INTEGER
  const timingAccumulator = createFixedStepAccumulator({
    fixedStepMs: PHYSICS_CADENCE_FIXED_STEP_MS,
    maxAcceptedWallDeltaMs: PHYSICS_CADENCE_MAX_ACCEPTED_WALL_DELTA_MS,
    overloadHighWaterMs: PHYSICS_CADENCE_OVERLOAD_HIGH_WATER_MS,
  })
  const simulation = createHeadlessRollSimulation(options)
  const initialState = simulation.getInitialState()
  const frames: CadenceRollFrameDiagnostics[] = []
  const frameToleranceMs = Math.max(1e-9, PHYSICS_CADENCE_FIXED_STEP_MS * 1e-8)
  const frameConservation: ConservationAccumulator = {
    maxFrameRawBalanceErrorMs: 0,
    maxFrameDiscardBalanceErrorMs: 0,
    maxFrameQueueBalanceErrorMs: 0,
  }

  function finishBase(): CadenceRollReportBase {
    const timing = timingAccumulator.snapshot()
    const session = simulation.snapshot()
    return {
      schemaVersion: CADENCE_ROLL_REPORT_SCHEMA_VERSION,
      seed: options.seed,
      cadence: { id: cadence.id, version: cadence.version },
      scheduler: {
        id: scheduler.id,
        version: scheduler.version,
        maxStepsPerFrame: scheduler.maxStepsPerFrame,
      },
      initialState,
      throwDiagnostics: simulation.throwDiagnostics,
      frames,
      timing,
      abandonedBacklog: {
        queuedMs: timing.queuedMs,
        queuedSteps: timing.queuedSteps,
        queuedWholeSteps: timing.queuedWholeSteps,
        interpolationAlpha: timing.interpolationAlpha,
        countedAsDiscarded: false,
      },
      conservation: finishConservation(
        frames,
        timing,
        frameConservation,
        frameToleranceMs,
        session.simulationStep,
        session.simulationTime * 1000,
      ),
    }
  }

  try {
    for (let cadenceFrameIndex = 0; cadenceFrameIndex < maxRenderFrames; cadenceFrameIndex++) {
      const cadenceFrame = getPhysicsCadenceFrame(cadence, cadenceFrameIndex)
      const queueBeforeMs = timingAccumulator.snapshot().queuedMs
      const plan = timingAccumulator.planFrame({
        ...cadenceFrame,
        maxSteps,
      })
      let settlement: ReturnType<typeof simulation.advanceExactStep>['settled'] = null

      for (let step = 0; step < plan.maxExecutableSteps; step++) {
        const advance = simulation.advanceExactStep()
        // 只有物理单步完整通过 exact contract 和安全链后，才从 backlog 扣除。
        timingAccumulator.consumeStep()
        if (advance.settled) {
          settlement = advance.settled
          break
        }
      }

      const frameResult = timingAccumulator.finishFrame()
      const frame: CadenceRollFrameDiagnostics = {
        ...frameResult,
        frameIndex: cadenceFrameIndex + 1,
        cadenceFrameIndex,
        queueBeforeMs,
        settledAtSimulationStep: settlement ? simulation.snapshot().simulationStep : null,
        unexecutedPlannedSteps: plan.maxExecutableSteps - frameResult.executedSteps,
        terminalKind: settlement
          ? 'settled'
          : plan.overload.active
            ? 'timing-overload'
            : cadenceFrameIndex === maxRenderFrames - 1
              ? 'frame-budget-exhausted'
              : null,
      }
      validateFrameConservation(frame, frameToleranceMs, frameConservation)
      frames.push(frame)

      if (plan.overload.active) {
        return {
          ...finishBase(),
          outcome: 'timing-overload',
          roll: null,
          partialDiagnostics: simulation.finishDiagnostics(),
        }
      }
      if (settlement) {
        const roll = simulation.finishRoll({
          settleReason: settlement.reason,
          settleTime: settlement.elapsed,
          settleFrame: simulation.snapshot().simulationStep,
        })
        return {
          ...finishBase(),
          outcome: 'settled',
          roll,
          partialDiagnostics: null,
        }
      }
    }

    return {
      ...finishBase(),
      outcome: 'frame-budget-exhausted',
      roll: null,
      partialDiagnostics: simulation.finishDiagnostics(),
    }
  } finally {
    simulation.dispose()
  }
}
