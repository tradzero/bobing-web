import { createPhysicsWorld } from './world'
import { createBowlBodies } from './bowl-body'
import { setupContactMaterials } from './materials'
import { createDiceBody } from '@/dice/dice-body'
import {
  captureCanonicalBodyState,
  cloneCanonicalBodyState,
  type CanonicalBodyStateDiagnostics,
} from '@/dice/canonical-body-state'
import { readAllFacesDetailed, type FaceReadResult } from '@/dice/read-face'
import type { SettleReason, SettleResult } from '@/dice/settle'
import {
  captureThrowInitialState,
  cloneThrowInitialState,
  type ThrowInitialStateDiagnostics,
} from '@/dice/throw-initial-state'
import { throwDice, type ThrowDiagnostics, type ThrowPlacementAlgorithm } from '@/dice/throw'
import { PHYSICS } from '@/config/physics'
import { SETTLE } from '@/config/settle'
import { reseed } from '@/utils/random'
import { type FloorRelaunchDiagnostics } from './floor-relaunch'
import type { RollFrameDiagnostics } from './roll-diagnostics'
import {
  createRollStepSession,
  type RollSettlementPolicy,
  type RollStepAdvanceResult,
  type RollStepSessionDiagnostics,
  type RollStepSessionSnapshot,
} from './roll-step-session'

/** 结构化验收报告 schema；字段语义发生不兼容变化时必须递增。 */
export const ROLL_DIAGNOSTICS_SCHEMA_VERSION = 4

export interface HeadlessRollSimulationOptions {
  seed: number
  /** runtime 使用正式停稳状态机；natural-continuation 只等自然 sleep 或独立帧预算。 */
  settlementPolicy?: RollSettlementPolicy
  /** 显式选择投掷位置算法；A/B 两侧仍复用同一完整运行链路。 */
  throwPlacementAlgorithm?: ThrowPlacementAlgorithm
  contactClusterAssistEnabled?: boolean
  /** 显式隔离只读姿态稳定窗口；未传时由 checkSettled 读取运行时配置。 */
  poseStableWindowEnabled?: boolean
}

export interface RollRunOptions extends HeadlessRollSimulationOptions {
  maxFrames?: number
}

export interface RollRunResult extends RollFrameDiagnostics {
  seed: number
  settleReason: SettleReason | 'frame-budget-exhausted' | 'continuation-budget-exhausted'
  settleTime: number
  /** session 实际完成的 exact Cannon 步数。 */
  simulationStep: number
  /** simulationStep × fixedTimeStep；不使用墙钟时间。 */
  simulationTime: number
  /** 兼容既有报告：成功结算时等于 simulationStep，预算耗尽时为 -1。 */
  settleFrame: number
  stableBrokenCount: number
  poseStableBrokenCount: number
  assistInterventionCount: number
  escapeGuardInterventionCount: number
  sleepWakeCount: number
  throwDiagnostics: ThrowDiagnostics
  finalFaces: FaceReadResult[]
  /** finish 后按 canonical dice body 顺序捕获的完整 Float64 终态。 */
  finalState: CanonicalBodyStateDiagnostics
  finalRadius: number
  finalMaxSpeed: number
  finalMaxAngularSpeed: number
  ambiguousDiceCount: number
  faceChangedDuringStableWindow: boolean
  maxStableWindowPositionDrift: number
  maxStableWindowAngularDrift: number
  longestStableWindow: number
  floorRelaunch: FloorRelaunchDiagnostics
}

export interface HeadlessRollTermination {
  settleReason: RollRunResult['settleReason']
  settleTime: number
  /** 兼容既有 report 字段；成功结算传 simulationStep，预算耗尽传 -1。 */
  settleFrame: number
}

/**
 * 无渲染投掷生命周期。初始化、正式 exact-step session 和最终读面只有这一份实现；
 * scheduler 只能决定何时调用 advanceExactStep，不能自行拼装物理/安全链。
 */
export interface HeadlessRollSimulation {
  readonly seed: number
  readonly throwDiagnostics: ThrowDiagnostics
  getInitialState: () => ThrowInitialStateDiagnostics
  advanceExactStep: () => RollStepAdvanceResult
  snapshot: () => RollStepSessionSnapshot
  finishDiagnostics: () => RollStepSessionDiagnostics
  finishRoll: (termination: HeadlessRollTermination) => RollRunResult
  dispose: () => void
}

export function createHeadlessRollSimulation(
  options: HeadlessRollSimulationOptions,
): HeadlessRollSimulation {
  const {
    seed,
    settlementPolicy = 'runtime',
    throwPlacementAlgorithm,
    contactClusterAssistEnabled,
    poseStableWindowEnabled,
  } = options

  reseed(seed)
  const physics = createPhysicsWorld()

  try {
    setupContactMaterials(physics.world)
    const bowlBodies = createBowlBodies(physics.world)
    const dicePairs = Array.from({ length: 6 }, () => {
      const body = createDiceBody()
      physics.world.addBody(body)
      return { mesh: {} as never, body }
    })
    const bodies = dicePairs.map(({ body }) => body)
    const throwDiagnostics = throwDice(dicePairs, {
      seed,
      algorithm: throwPlacementAlgorithm,
    })
    const initialState = captureThrowInitialState(bodies)
    const stepSession = createRollStepSession({
      world: physics.world,
      bodies,
      stepExact: physics.stepExact,
      settlementPolicy,
      contactClusterAssistEnabled,
      poseStableWindowEnabled,
      floorRelaunchTracking: { bowlBottom: bowlBodies.bottom },
      stableWindowDiagnosticsEnabled: true,
    })

    let disposed = false
    let finalization: 'diagnostics' | 'roll' | null = null
    let finalDiagnostics: RollStepSessionDiagnostics | null = null
    let finalRoll: RollRunResult | null = null
    let terminalSettlement: Readonly<SettleResult> | null = null

    function requireActive(): void {
      if (disposed) throw new Error('headless roll simulation 已 dispose')
    }

    function finishDiagnostics(): RollStepSessionDiagnostics {
      requireActive()
      if (!finalDiagnostics) finalDiagnostics = stepSession.finish()
      if (!finalization) finalization = 'diagnostics'
      return finalDiagnostics
    }

    function finishRoll(termination: HeadlessRollTermination): RollRunResult {
      requireActive()
      if (finalRoll) {
        return { ...finalRoll, finalState: cloneCanonicalBodyState(finalRoll.finalState) }
      }
      if (finalization === 'diagnostics') {
        throw new Error('headless roll simulation 已按非结算诊断结束，不能再生成 RollRunResult')
      }

      const sessionSnapshot = stepSession.snapshot()
      const budgetExhausted =
        termination.settleReason === 'frame-budget-exhausted' ||
        termination.settleReason === 'continuation-budget-exhausted'
      const timeTolerance = PHYSICS.fixedTimeStep * 1e-9
      if (budgetExhausted) {
        const expectedBudgetReason =
          settlementPolicy === 'runtime'
            ? 'frame-budget-exhausted'
            : 'continuation-budget-exhausted'
        if (
          termination.settleReason !== expectedBudgetReason ||
          terminalSettlement ||
          termination.settleFrame !== -1 ||
          Math.abs(termination.settleTime - sessionSnapshot.simulationTime) > timeTolerance
        ) {
          throw new Error('headless roll budget termination 与 session 状态不一致')
        }
      } else if (
        !terminalSettlement ||
        termination.settleReason !== terminalSettlement.reason ||
        termination.settleFrame !== sessionSnapshot.simulationStep ||
        Math.abs(termination.settleTime - sessionSnapshot.simulationTime) > timeTolerance ||
        Math.abs(termination.settleTime - terminalSettlement.elapsed) > timeTolerance
      ) {
        throw new Error('headless roll settled termination 与 session 状态不一致')
      }

      finalDiagnostics = stepSession.finish()
      // finalize 完成后才捕获终态；capture 只读且返回与 Cannon body 脱离的 Float64 快照。
      const finalState = captureCanonicalBodyState(bodies)
      const finalFaces = readAllFacesDetailed(bodies)
      const finalRadius = Math.max(
        ...bodies.map(({ position }) => Math.hypot(position.x, position.z)),
      )
      const finalMaxSpeed = Math.max(...bodies.map(({ velocity }) => velocity.length()))
      const finalMaxAngularSpeed = Math.max(
        ...bodies.map(({ angularVelocity }) => angularVelocity.length()),
      )
      finalization = 'roll'
      finalRoll = {
        seed,
        ...finalDiagnostics,
        ...termination,
        throwDiagnostics,
        finalFaces,
        finalState,
        finalRadius,
        finalMaxSpeed,
        finalMaxAngularSpeed,
        ambiguousDiceCount: finalFaces.filter(({ confidence }) => confidence < SETTLE.tiltThreshold)
          .length,
      }
      return { ...finalRoll, finalState: cloneCanonicalBodyState(finalState) }
    }

    return {
      seed,
      throwDiagnostics,
      getInitialState() {
        requireActive()
        return cloneThrowInitialState(initialState)
      },
      advanceExactStep() {
        requireActive()
        if (finalization) throw new Error('headless roll simulation 已结束，不能继续推进')
        const result = stepSession.advanceExactStep()
        if (!result.settled) return result

        // caller 会拿到独立副本；canonical terminal 不允许被 scheduler 篡改后绕过 finalize 校验。
        terminalSettlement = Object.freeze({
          reason: result.settled.reason,
          elapsed: result.settled.elapsed,
        })
        return {
          ...result,
          settled: {
            reason: terminalSettlement.reason,
            elapsed: terminalSettlement.elapsed,
          },
        }
      },
      snapshot() {
        requireActive()
        return stepSession.snapshot()
      },
      finishDiagnostics,
      finishRoll,
      dispose() {
        if (disposed) return
        disposed = true
        physics.dispose()
      },
    }
  } catch (error) {
    physics.dispose()
    throw error
  }
}

/**
 * 无渲染的完整投掷运行器。
 * 运行时与测试共用 throw、物理世界、逃逸保护和停稳检测，不复制算法。
 */
export function runRoll(options: RollRunOptions): RollRunResult {
  const {
    settlementPolicy = 'runtime',
    maxFrames = Math.ceil(
      (settlementPolicy === 'runtime' ? SETTLE.timeout : 20) / PHYSICS.fixedTimeStep,
    ) + 1,
  } = options
  const simulation = createHeadlessRollSimulation(options)

  try {
    let settleReason: RollRunResult['settleReason'] =
      settlementPolicy === 'runtime' ? 'frame-budget-exhausted' : 'continuation-budget-exhausted'
    let settleTime = maxFrames * PHYSICS.fixedTimeStep
    let settleFrame = -1
    for (let frame = 1; frame <= maxFrames; frame++) {
      const { settled } = simulation.advanceExactStep()

      if (settled) {
        settleReason = settled.reason
        settleTime = settled.elapsed
        settleFrame = frame
        break
      }
    }

    return simulation.finishRoll({ settleReason, settleTime, settleFrame })
  } finally {
    simulation.dispose()
  }
}

/** 方便 CLI/失败报告序列化，避免输出 cannon-es 对象。 */
export function serializeRollResult(result: RollRunResult): Record<string, unknown> {
  return {
    ...result,
    finalFaces: result.finalFaces.map(({ value, confidence }) => ({
      value,
      confidence: Number(confidence.toFixed(6)),
    })),
  }
}
