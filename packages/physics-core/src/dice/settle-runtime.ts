import * as CANNON from 'cannon-es'
import { SETTLE } from '../config/settle'
import { readAllFacesDetailed } from './read-face'

/** seed 复现记录使用；改变停稳状态机语义时必须递增。 */
export const SETTLE_ALGORITHM_VERSION = 4

export interface ContactClusterAssistState {
  firstSeenAtByClusterKey: Map<string, number>
  assistedClusterKeys: Set<string>
}

export interface SettleState {
  startTime: number
  stableStartTime: number
  stableBrokenCount: number
  poseStableAnchor: {
    startedAt: number
    positions: CANNON.Vec3[]
    quaternions: CANNON.Quaternion[]
    faces: number[]
  } | null
  poseStableBrokenCount: number
  /** 实验层可以写入；生产路径始终保持空集合。 */
  contactClusterAssist: ContactClusterAssistState
}

export type SettleReason =
  | 'natural-sleep'
  | 'stable-window'
  | 'pose-stable-window'
  | 'cluster-assist'
  | 'timeout'

export interface SettleResult {
  reason: SettleReason
  elapsed: number
}

export function createSettleState(startTime: number): SettleState {
  return {
    startTime,
    stableStartTime: -1,
    stableBrokenCount: 0,
    poseStableAnchor: null,
    poseStableBrokenCount: 0,
    contactClusterAssist: {
      firstSeenAtByClusterKey: new Map(),
      assistedClusterKeys: new Set(),
    },
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

/** 不包含历史 assist 的正式停稳状态机。 */
export function checkSettledRuntime(
  bodies: CANNON.Body[],
  currentTime: number,
  state: SettleState,
  poseStableWindowEnabled: boolean = SETTLE.poseStableWindow.enabled,
): SettleResult | null {
  const elapsed = currentTime - state.startTime
  if (elapsed >= SETTLE.timeout) return { reason: 'timeout', elapsed }

  if (bodies.every((body) => body.sleepState === CANNON.Body.SLEEPING)) {
    return {
      reason:
        state.contactClusterAssist.assistedClusterKeys.size > 0
          ? 'cluster-assist'
          : 'natural-sleep',
      elapsed,
    }
  }

  if (checkPoseStableWindow(bodies, currentTime, state, poseStableWindowEnabled)) {
    return { reason: 'pose-stable-window', elapsed }
  }

  const allBelowThreshold = bodies.every(
    (body) =>
      body.velocity.length() < SETTLE.speedThreshold &&
      body.angularVelocity.length() < SETTLE.angularThreshold,
  )
  if (allBelowThreshold) {
    if (state.stableStartTime < 0) {
      state.stableStartTime = currentTime
    } else if (currentTime - state.stableStartTime >= SETTLE.stableDuration) {
      return {
        reason:
          state.contactClusterAssist.assistedClusterKeys.size > 0
            ? 'cluster-assist'
            : 'stable-window',
        elapsed,
      }
    }
  } else {
    if (state.stableStartTime >= 0) state.stableBrokenCount++
    state.stableStartTime = -1
  }
  return null
}

/** 与通用调用签名一致；生产忽略只属于实验层的 world/assist 参数。 */
export function checkSettled(
  bodies: CANNON.Body[],
  currentTime: number,
  state: SettleState,
  world?: CANNON.World,
  contactClusterAssistEnabled?: boolean,
  poseStableWindowEnabled: boolean = SETTLE.poseStableWindow.enabled,
): SettleResult | null {
  void world
  void contactClusterAssistEnabled
  return checkSettledRuntime(bodies, currentTime, state, poseStableWindowEnabled)
}
