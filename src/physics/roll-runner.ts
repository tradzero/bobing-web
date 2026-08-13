import { createPhysicsWorld } from './world'
import { createBowlBodies } from './bowl-body'
import { setupContactMaterials } from './materials'
import { createDiceBody } from '@/dice/dice-body'
import { readAllFacesDetailed, type FaceReadResult } from '@/dice/read-face'
import type { SettleReason } from '@/dice/settle'
import { throwDice, type ThrowDiagnostics, type ThrowPlacementAlgorithm } from '@/dice/throw'
import { PHYSICS } from '@/config/physics'
import { SETTLE } from '@/config/settle'
import { reseed } from '@/utils/random'
import { type FloorRelaunchDiagnostics } from './floor-relaunch'
import type { RollFrameDiagnostics } from './roll-diagnostics'
import { createRollStepSession, type RollSettlementPolicy } from './roll-step-session'

/** 结构化验收报告 schema；字段语义发生不兼容变化时必须递增。 */
export const ROLL_DIAGNOSTICS_SCHEMA_VERSION = 3

export interface RollRunOptions {
  seed: number
  maxFrames?: number
  /** runtime 使用正式停稳状态机；natural-continuation 只等自然 sleep 或独立帧预算。 */
  settlementPolicy?: RollSettlementPolicy
  /** 显式选择投掷位置算法；A/B 两侧仍复用同一完整运行链路。 */
  throwPlacementAlgorithm?: ThrowPlacementAlgorithm
  contactClusterAssistEnabled?: boolean
  /** 显式隔离只读姿态稳定窗口；未传时由 checkSettled 读取运行时配置。 */
  poseStableWindowEnabled?: boolean
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

/**
 * 无渲染的完整投掷运行器。
 * 运行时与测试共用 throw、物理世界、逃逸保护和停稳检测，不复制算法。
 */
export function runRoll(options: RollRunOptions): RollRunResult {
  const {
    seed,
    settlementPolicy = 'runtime',
    maxFrames = Math.ceil(
      (settlementPolicy === 'runtime' ? SETTLE.timeout : 20) / PHYSICS.fixedTimeStep,
    ) + 1,
    throwPlacementAlgorithm,
    contactClusterAssistEnabled,
    poseStableWindowEnabled,
  } = options

  reseed(seed)
  const { world, stepExact, dispose } = createPhysicsWorld()

  try {
    setupContactMaterials(world)
    const bowlBodies = createBowlBodies(world)

    const dicePairs = Array.from({ length: 6 }, () => {
      const body = createDiceBody()
      world.addBody(body)
      return { mesh: {} as never, body }
    })
    const bodies = dicePairs.map(({ body }) => body)
    const throwDiagnostics = throwDice(dicePairs, {
      seed,
      algorithm: throwPlacementAlgorithm,
    })
    const stepSession = createRollStepSession({
      world,
      bodies,
      stepExact,
      settlementPolicy,
      contactClusterAssistEnabled,
      poseStableWindowEnabled,
      floorRelaunchTracking: { bowlBottom: bowlBodies.bottom },
      stableWindowDiagnosticsEnabled: true,
    })

    let settleReason: RollRunResult['settleReason'] =
      settlementPolicy === 'runtime' ? 'frame-budget-exhausted' : 'continuation-budget-exhausted'
    let settleTime = maxFrames * PHYSICS.fixedTimeStep
    let settleFrame = -1
    for (let frame = 1; frame <= maxFrames; frame++) {
      const { settled } = stepSession.advanceExactStep()

      if (settled) {
        settleReason = settled.reason
        settleTime = settled.elapsed
        settleFrame = frame
        break
      }
    }

    const finalFaces = readAllFacesDetailed(bodies)
    const finalRadius = Math.max(
      ...bodies.map(({ position }) => Math.hypot(position.x, position.z)),
    )
    const finalMaxSpeed = Math.max(...bodies.map(({ velocity }) => velocity.length()))
    const finalMaxAngularSpeed = Math.max(
      ...bodies.map(({ angularVelocity }) => angularVelocity.length()),
    )
    const stepDiagnostics = stepSession.finish()

    return {
      seed,
      ...stepDiagnostics,
      settleReason,
      settleTime,
      settleFrame,
      throwDiagnostics,
      finalFaces,
      finalRadius,
      finalMaxSpeed,
      finalMaxAngularSpeed,
      ambiguousDiceCount: finalFaces.filter(({ confidence }) => confidence < SETTLE.tiltThreshold)
        .length,
    }
  } finally {
    dispose()
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
