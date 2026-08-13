import * as CANNON from 'cannon-es'
import { createPhysicsWorld } from './world'
import { createBowlBodies } from './bowl-body'
import { setupContactMaterials } from './materials'
import { applyEscapeGuard } from './escape-guard'
import { createDiceBody } from '@/dice/dice-body'
import { readAllFacesDetailed, type FaceReadResult } from '@/dice/read-face'
import { checkSettled, createSettleState, type SettleReason } from '@/dice/settle'
import { throwDice, type ThrowDiagnostics, type ThrowPlacementAlgorithm } from '@/dice/throw'
import { PHYSICS } from '@/config/physics'
import { SETTLE } from '@/config/settle'
import { reseed } from '@/utils/random'
import {
  createRollFrameDiagnostics,
  sampleRollFrameDiagnostics,
  type RollFrameDiagnostics,
} from './roll-diagnostics'

/** 结构化验收报告 schema；字段语义发生不兼容变化时必须递增。 */
export const ROLL_DIAGNOSTICS_SCHEMA_VERSION = 1

export interface RollRunOptions {
  seed: number
  maxFrames?: number
  /** runtime 使用正式停稳状态机；natural-continuation 只等自然 sleep 或独立帧预算。 */
  settlementPolicy?: 'runtime' | 'natural-continuation'
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
}

interface StableWindowTracker {
  startedAt: number
  positions: CANNON.Vec3[]
  quaternions: CANNON.Quaternion[]
  faces: number[]
}

function quaternionAngularDistance(a: CANNON.Quaternion, b: CANNON.Quaternion): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)
  return 2 * Math.acos(Math.min(1, dot))
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
  const { world, step, dispose } = createPhysicsWorld()

  try {
    setupContactMaterials(world)
    createBowlBodies(world)

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
    const settleState = createSettleState(0)
    const diagnostics = createRollFrameDiagnostics()

    let settleReason: RollRunResult['settleReason'] =
      settlementPolicy === 'runtime' ? 'frame-budget-exhausted' : 'continuation-budget-exhausted'
    let settleTime = maxFrames * PHYSICS.fixedTimeStep
    let settleFrame = -1
    let escapeGuardInterventionCount = 0
    let sleepWakeCount = 0
    let faceChangedDuringStableWindow = false
    let maxStableWindowPositionDrift = 0
    let maxStableWindowAngularDrift = 0
    let longestStableWindow = 0
    let stableWindow: StableWindowTracker | null = null
    const previousSleepStates = bodies.map(({ sleepState }) => sleepState)

    for (let frame = 1; frame <= maxFrames; frame++) {
      step(PHYSICS.fixedTimeStep)
      const currentTime = frame * PHYSICS.fixedTimeStep

      sampleRollFrameDiagnostics(diagnostics, bodies, world)
      for (const body of bodies) {
        if (applyEscapeGuard(body)) escapeGuardInterventionCount++
      }

      const settled =
        settlementPolicy === 'runtime'
          ? checkSettled(
              bodies,
              currentTime,
              settleState,
              world,
              contactClusterAssistEnabled,
              poseStableWindowEnabled,
            )
          : bodies.every((body) => body.sleepState === CANNON.Body.SLEEPING)
            ? { reason: 'natural-sleep' as const, elapsed: currentTime }
            : null

      for (let index = 0; index < bodies.length; index++) {
        if (
          previousSleepStates[index] === CANNON.Body.SLEEPING &&
          bodies[index].sleepState !== CANNON.Body.SLEEPING
        ) {
          sleepWakeCount++
        }
        previousSleepStates[index] = bodies[index].sleepState
      }

      const allBelowStableThreshold = bodies.every(
        (body) =>
          body.velocity.length() < SETTLE.speedThreshold &&
          body.angularVelocity.length() < SETTLE.angularThreshold,
      )
      if (!allBelowStableThreshold) {
        stableWindow = null
      } else if (!stableWindow) {
        stableWindow = {
          startedAt: currentTime,
          positions: bodies.map(({ position }) => position.clone()),
          quaternions: bodies.map(({ quaternion }) => quaternion.clone()),
          faces: readAllFacesDetailed(bodies).map(({ value }) => value),
        }
      } else {
        longestStableWindow = Math.max(longestStableWindow, currentTime - stableWindow.startedAt)
        const currentFaces = readAllFacesDetailed(bodies)
        for (let index = 0; index < bodies.length; index++) {
          maxStableWindowPositionDrift = Math.max(
            maxStableWindowPositionDrift,
            stableWindow.positions[index].distanceTo(bodies[index].position),
          )
          maxStableWindowAngularDrift = Math.max(
            maxStableWindowAngularDrift,
            quaternionAngularDistance(stableWindow.quaternions[index], bodies[index].quaternion),
          )
          if (currentFaces[index].value !== stableWindow.faces[index]) {
            faceChangedDuringStableWindow = true
          }
        }
      }

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

    return {
      seed,
      ...diagnostics,
      settleReason,
      settleTime,
      settleFrame,
      stableBrokenCount: settleState.stableBrokenCount,
      poseStableBrokenCount: settleState.poseStableBrokenCount,
      assistInterventionCount: settleState.contactClusterAssist.assistedClusterKeys.size,
      escapeGuardInterventionCount,
      sleepWakeCount,
      throwDiagnostics,
      finalFaces,
      finalRadius,
      finalMaxSpeed,
      finalMaxAngularSpeed,
      ambiguousDiceCount: finalFaces.filter(({ confidence }) => confidence < SETTLE.tiltThreshold)
        .length,
      faceChangedDuringStableWindow,
      maxStableWindowPositionDrift,
      maxStableWindowAngularDrift,
      longestStableWindow,
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
