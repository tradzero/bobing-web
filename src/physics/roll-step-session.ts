import * as CANNON from 'cannon-es'
import { PHYSICS } from '@/config/physics'
import { SETTLE } from '@/config/settle'
import { readAllFacesDetailed } from '@/dice/read-face'
import { checkSettled, createSettleState, type SettleResult } from '@/dice/settle'
import { applyEscapeGuard } from './escape-guard'
import {
  createBoxFloorFrameSampler,
  createFloorRelaunchTracker,
  unavailableFloorRelaunchDiagnostics,
  type FloorRelaunchDiagnostics,
} from './floor-relaunch'
import {
  createRollFrameDiagnostics,
  sampleRollBodyDiagnostics,
  sampleRollFrameDiagnostics,
  type RollFrameDiagnostics,
} from './roll-diagnostics'

export type RollSettlementPolicy = 'runtime' | 'natural-continuation'

export interface RollStepSessionOptions {
  world: CANNON.World
  bodies: readonly CANNON.Body[]
  stepExact: () => void
  settlementPolicy: RollSettlementPolicy
  contactClusterAssistEnabled?: boolean
  poseStableWindowEnabled?: boolean
  /** runner/诊断模式显式开启；普通运行时不必承担 Heightfield 顶点采样成本。 */
  floorRelaunchTracking?: { bowlBottom: CANNON.Body }
  /** 额外记录低速窗口中的姿态/读面漂移；不参与正式 settle 决策。 */
  stableWindowDiagnosticsEnabled?: boolean
  /** 通用阶段包装器；性能采样可在外部计时，session 不依赖渲染或 profile 类型。 */
  runPhase?: (phase: RollStepPhase, action: () => void) => void
}

export type RollStepPhase =
  | 'world-step'
  | 'roll-safety'
  | 'floor-relaunch'
  | 'escape-guard'
  | 'settle'
  | 'stable-window-diagnostics'

export interface RollStepAdvanceResult {
  simulationStep: number
  simulationTime: number
  settled: SettleResult | null
}

export interface RollStepSessionSnapshot extends RollFrameDiagnostics {
  simulationStep: number
  simulationTime: number
  stableBrokenCount: number
  poseStableBrokenCount: number
  assistInterventionCount: number
  escapeGuardInterventionCount: number
  sleepWakeCount: number
  faceChangedDuringStableWindow: boolean
  maxStableWindowPositionDrift: number
  maxStableWindowAngularDrift: number
  longestStableWindow: number
}

export interface RollStepSessionDiagnostics extends RollStepSessionSnapshot {
  floorRelaunch: FloorRelaunchDiagnostics
}

export interface RollStepSession {
  /** 精确推进一个固定物理步，并完成该步全部安全、介入与停稳观察。 */
  advanceExactStep: () => RollStepAdvanceResult
  /** 返回非终止只读快照；不会 finalize floor episode。 */
  snapshot: () => RollStepSessionSnapshot
  /** 结束本轮逐步诊断；调用后不允许继续推进。 */
  finish: () => RollStepSessionDiagnostics
}

interface StableWindowTracker {
  startedAt: number
  positions: CANNON.Vec3[]
  quaternions: CANNON.Quaternion[]
  faces: number[]
}

/** 相对 fixed step 的严格浮点容差；远小于可形成下一物理步的任何时间债务。 */
const EXACT_STEP_TIME_TOLERANCE = PHYSICS.fixedTimeStep * 1e-9

function nearlyEqualTime(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= EXACT_STEP_TIME_TOLERANCE
}

function requireEmptyCannonAccumulator(accumulator: number, stage: string): void {
  if (!nearlyEqualTime(accumulator, 0)) {
    throw new Error(
      `exact step contract 失败：${stage} world.accumulator 应近似 0，实际 ${accumulator}`,
    )
  }
}

function quaternionAngularDistance(a: CANNON.Quaternion, b: CANNON.Quaternion): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)
  return 2 * Math.acos(Math.min(1, dot))
}

/**
 * 一轮投掷的精确单步执行内核。
 *
 * session 固定拥有以下顺序，headless runner 与未来运行时调度不能各自复制：
 * exact step -> 模拟时间 -> 原始安全/contact/floor 采样 -> escape guard ->
 * settle -> sleep/stable 诊断。
 */
export function createRollStepSession(options: RollStepSessionOptions): RollStepSession {
  const {
    world,
    stepExact,
    settlementPolicy,
    contactClusterAssistEnabled,
    poseStableWindowEnabled,
    floorRelaunchTracking,
    stableWindowDiagnosticsEnabled = false,
  } = options
  const bodies = [...options.bodies]
  requireEmptyCannonAccumulator(world.accumulator, 'session 创建时')
  const runPhase: NonNullable<RollStepSessionOptions['runPhase']> =
    options.runPhase ?? ((_phase, action) => action())
  const settleState = createSettleState(0)
  const diagnostics = createRollFrameDiagnostics()
  // throw/teleport 后先只采 body；world.contacts 此时仍可能属于上一轮，不能混入。
  sampleRollBodyDiagnostics(diagnostics, bodies)
  const floorFrameSampler = floorRelaunchTracking
    ? createBoxFloorFrameSampler(bodies, floorRelaunchTracking.bowlBottom)
    : null
  const floorRelaunchTracker = floorFrameSampler?.available
    ? createFloorRelaunchTracker(bodies.length)
    : null
  const previousSleepStates = bodies.map(({ sleepState }) => sleepState)

  let simulationStep = 0
  let settledResult: SettleResult | null = null
  let escapeGuardInterventionCount = 0
  let sleepWakeCount = 0
  let faceChangedDuringStableWindow = false
  let maxStableWindowPositionDrift = 0
  let maxStableWindowAngularDrift = 0
  let longestStableWindow = 0
  let stableWindow: StableWindowTracker | null = null
  let finishedDiagnostics: RollStepSessionDiagnostics | null = null

  function advanceExactStep(): RollStepAdvanceResult {
    if (finishedDiagnostics) throw new Error('roll step session 已结束，不能继续推进')
    if (settledResult) throw new Error('roll step session 已停稳，不能继续推进')

    const stepnumberBefore = world.stepnumber
    const worldTimeBefore = world.time
    const accumulatorBefore = world.accumulator
    requireEmptyCannonAccumulator(accumulatorBefore, 'step 前')
    runPhase('world-step', stepExact)
    const stepnumberDelta = world.stepnumber - stepnumberBefore
    const worldTimeDelta = world.time - worldTimeBefore
    const accumulatorAfter = world.accumulator
    if (
      stepnumberDelta !== 1 ||
      !nearlyEqualTime(worldTimeDelta, PHYSICS.fixedTimeStep) ||
      !nearlyEqualTime(accumulatorAfter, 0)
    ) {
      throw new Error(
        'exact step contract 失败：' +
          `stepnumber delta=${stepnumberDelta}（应为 1），` +
          `world.time delta=${worldTimeDelta}（应为 ${PHYSICS.fixedTimeStep}），` +
          `accumulator before/after=${accumulatorBefore}/${accumulatorAfter}（应近似 0）`,
      )
    }
    simulationStep++
    const simulationTime = simulationStep * PHYSICS.fixedTimeStep

    // 必须先记录未经介入的物理事实，避免 guard 把异常轨迹从诊断中抹掉。
    runPhase('roll-safety', () => sampleRollFrameDiagnostics(diagnostics, bodies, world))
    if (floorRelaunchTracker) {
      runPhase('floor-relaunch', () => {
        floorRelaunchTracker.sample(floorFrameSampler!.sample(world.contacts))
      })
    }
    runPhase('escape-guard', () => {
      for (const body of bodies) {
        if (applyEscapeGuard(body)) escapeGuardInterventionCount++
      }
    })

    let settled: SettleResult | null = null
    runPhase('settle', () => {
      settled =
        settlementPolicy === 'runtime'
          ? checkSettled(
              bodies,
              simulationTime,
              settleState,
              world,
              contactClusterAssistEnabled,
              poseStableWindowEnabled,
            )
          : bodies.every((body) => body.sleepState === CANNON.Body.SLEEPING)
            ? { reason: 'natural-sleep' as const, elapsed: simulationTime }
            : null
    })

    for (let index = 0; index < bodies.length; index++) {
      if (
        previousSleepStates[index] === CANNON.Body.SLEEPING &&
        bodies[index].sleepState !== CANNON.Body.SLEEPING
      ) {
        sleepWakeCount++
      }
      previousSleepStates[index] = bodies[index].sleepState
    }

    if (stableWindowDiagnosticsEnabled) {
      runPhase('stable-window-diagnostics', () => {
        const allBelowStableThreshold = bodies.every(
          (body) =>
            body.velocity.length() < SETTLE.speedThreshold &&
            body.angularVelocity.length() < SETTLE.angularThreshold,
        )
        if (!allBelowStableThreshold) {
          stableWindow = null
        } else if (!stableWindow) {
          stableWindow = {
            startedAt: simulationTime,
            positions: bodies.map(({ position }) => position.clone()),
            quaternions: bodies.map(({ quaternion }) => quaternion.clone()),
            faces: readAllFacesDetailed(bodies).map(({ value }) => value),
          }
        } else {
          longestStableWindow = Math.max(
            longestStableWindow,
            simulationTime - stableWindow.startedAt,
          )
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
      })
    }

    if (settled) settledResult = settled
    return { simulationStep, simulationTime, settled }
  }

  function snapshot(): RollStepSessionSnapshot {
    return {
      simulationStep,
      simulationTime: simulationStep * PHYSICS.fixedTimeStep,
      ...diagnostics,
      stableBrokenCount: settleState.stableBrokenCount,
      poseStableBrokenCount: settleState.poseStableBrokenCount,
      assistInterventionCount: settleState.contactClusterAssist.assistedClusterKeys.size,
      escapeGuardInterventionCount,
      sleepWakeCount,
      faceChangedDuringStableWindow,
      maxStableWindowPositionDrift,
      maxStableWindowAngularDrift,
      longestStableWindow,
    }
  }

  function finish(): RollStepSessionDiagnostics {
    if (finishedDiagnostics) return finishedDiagnostics

    const floorRelaunch = floorRelaunchTracker
      ? floorRelaunchTracker.finish()
      : unavailableFloorRelaunchDiagnostics(
          floorFrameSampler?.unavailableReason ?? 'floor relaunch tracking disabled',
        )
    finishedDiagnostics = {
      ...snapshot(),
      floorRelaunch,
    }
    return finishedDiagnostics
  }

  return { advanceExactStep, snapshot, finish }
}
