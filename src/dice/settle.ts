import * as CANNON from 'cannon-es'
import { SETTLE } from '@/config/settle'
import { readAllFacesDetailed } from './read-face'
import {
  applyContactClusterSettleAssist,
  createContactClusterAssistState,
  type ContactClusterAssistState,
} from './contact-cluster-assist'

/** seed 复现记录使用；改变停稳状态机语义时必须递增。 */
export const SETTLE_ALGORITHM_VERSION = 4

/**
 * 停稳检测状态（每次投掷重置）
 */
export interface SettleState {
  /** 投掷开始时间 (s) */
  startTime: number
  /** 连续低速开始时间 (s)，-1 表示尚未开始 */
  stableStartTime: number
  /** 低速窗口被打断次数（用于诊断 / sweep 统计） */
  stableBrokenCount: number
  /** 只读姿态窗口锚点；只比较，不回写 body。 */
  poseStableAnchor: {
    startedAt: number
    positions: CANNON.Vec3[]
    quaternions: CANNON.Quaternion[]
    faces: number[]
  } | null
  /** 姿态窗口被位移、转角或读面变化打断的次数。 */
  poseStableBrokenCount: number
  /** 尾段接触簇辅助状态（每次投掷重置） */
  contactClusterAssist: ContactClusterAssistState
}

/**
 * 停稳原因。
 * - natural-sleep: 所有刚体由 cannon-es 自然进入 sleep
 * - stable-window: 所有刚体连续满足低速窗口
 * - cluster-assist: 本轮曾由尾段接触簇辅助冻结刚体
 * - timeout: 达到超时上限后兜底结算
 */
export type SettleReason =
  | 'natural-sleep'
  | 'stable-window'
  | 'pose-stable-window'
  | 'cluster-assist'
  | 'timeout'

/** 一次停稳检测的结构化结果；null 表示本帧尚未停稳。 */
export interface SettleResult {
  reason: SettleReason
  /** 从本轮 beginSettle 到结算的逻辑时间 (s) */
  elapsed: number
}

/** 创建初始停稳状态 */
export function createSettleState(startTime: number): SettleState {
  return {
    startTime,
    stableStartTime: -1,
    stableBrokenCount: 0,
    poseStableAnchor: null,
    poseStableBrokenCount: 0,
    contactClusterAssist: createContactClusterAssistState(),
  }
}

function quaternionAngularDistance(a: CANNON.Quaternion, b: CANNON.Quaternion): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)
  return 2 * Math.acos(Math.min(1, dot))
}

function readFaceValues(bodies: CANNON.Body[]): number[] {
  return readAllFacesDetailed(bodies).map(({ value }) => value)
}

function checkPoseStableWindow(
  bodies: CANNON.Body[],
  currentTime: number,
  state: SettleState,
  enabled: boolean,
): boolean {
  const config = SETTLE.poseStableWindow
  if (!enabled) {
    state.poseStableAnchor = null
    return false
  }
  if (currentTime - state.startTime < config.activationDelay) return false

  if (!state.poseStableAnchor) {
    state.poseStableAnchor = {
      startedAt: currentTime,
      positions: bodies.map(({ position }) => position.clone()),
      quaternions: bodies.map(({ quaternion }) => quaternion.clone()),
      faces: readFaceValues(bodies),
    }
    return false
  }

  const currentFaces = readFaceValues(bodies)
  const drifted = bodies.some(
    (body, index) =>
      body.position.distanceTo(state.poseStableAnchor!.positions[index]) >
        config.maxPositionDrift ||
      quaternionAngularDistance(body.quaternion, state.poseStableAnchor!.quaternions[index]) >
        config.maxAngularDrift ||
      currentFaces[index] !== state.poseStableAnchor!.faces[index],
  )
  if (drifted) {
    state.poseStableAnchor = null
    state.poseStableBrokenCount++
    return false
  }

  return currentTime - state.poseStableAnchor.startedAt >= config.duration
}

/**
 * 停稳检测函数（会修改传入的 state 对象记录计时状态）
 * 接受骰子 body 数组和当前时间，返回结构化停稳结果
 * 不自持轮询，由 engine 每帧调用
 *
 * 五类诊断结果：
 * 1. 全部 sleep → 直接停稳
 * 2. 空间姿态与读面持续不变 → 只读停稳
 * 3. 连续低速持续一段时间 → 停稳
 * 4. 本轮接触簇辅助介入 → 标记 cluster-assist
 * 5. 超时兜底 → 强制停稳并标记 timeout
 */
export function checkSettled(
  bodies: CANNON.Body[],
  currentTime: number,
  state: SettleState,
  world?: CANNON.World,
  contactClusterAssistEnabled: boolean = SETTLE.contactClusterAssist.defaultEnabled,
  poseStableWindowEnabled: boolean = SETTLE.poseStableWindow.enabled,
): SettleResult | null {
  if (world && contactClusterAssistEnabled) {
    applyContactClusterSettleAssist(
      world,
      bodies,
      currentTime,
      state.contactClusterAssist,
      state.startTime,
    )
  }

  const elapsed = currentTime - state.startTime

  // 路径 3：超时兜底。诊断上优先标记 timeout，避免被普通 settled 掩盖。
  if (elapsed >= SETTLE.timeout) {
    return { reason: 'timeout', elapsed }
  }

  // 路径 1：全部 body 进入 sleep
  if (bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING)) {
    return {
      reason:
        state.contactClusterAssist.assistedClusterKeys.size > 0
          ? 'cluster-assist'
          : 'natural-sleep',
      elapsed,
    }
  }

  // 路径 2：只读空间姿态窗口；不修改任何刚体状态。
  if (checkPoseStableWindow(bodies, currentTime, state, poseStableWindowEnabled)) {
    return { reason: 'pose-stable-window', elapsed }
  }

  // 路径 3：速度阈值检测
  const allBelowThreshold = bodies.every((b) => {
    const speed = b.velocity.length()
    const angularSpeed = b.angularVelocity.length()
    return speed < SETTLE.speedThreshold && angularSpeed < SETTLE.angularThreshold
  })

  if (allBelowThreshold) {
    if (state.stableStartTime < 0) {
      // 开始计时
      state.stableStartTime = currentTime
    } else if (currentTime - state.stableStartTime >= SETTLE.stableDuration) {
      // 持续低速满足时间要求
      return {
        reason:
          state.contactClusterAssist.assistedClusterKeys.size > 0
            ? 'cluster-assist'
            : 'stable-window',
        elapsed,
      }
    }
  } else {
    // 速度超过阈值，重置计时
    if (state.stableStartTime >= 0) state.stableBrokenCount++
    state.stableStartTime = -1
  }

  return null
}
