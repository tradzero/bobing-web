import * as CANNON from 'cannon-es'
import { SETTLE } from '@/config/settle'
import {
  applyContactClusterSettleAssist,
  createContactClusterAssistState,
  type ContactClusterAssistState,
} from './contact-cluster-assist'

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
  /** 尾段接触簇辅助状态（每次投掷重置） */
  contactClusterAssist: ContactClusterAssistState
}

/** 创建初始停稳状态 */
export function createSettleState(startTime: number): SettleState {
  return {
    startTime,
    stableStartTime: -1,
    stableBrokenCount: 0,
    contactClusterAssist: createContactClusterAssistState(),
  }
}

/**
 * 停稳检测函数（会修改传入的 state 对象记录计时状态）
 * 接受骰子 body 数组和当前时间，返回是否停稳
 * 不自持轮询，由 engine 每帧调用
 *
 * 三条判定路径：
 * 1. 全部 sleep → 直接停稳
 * 2. 连续低速持续一段时间 → 停稳
 * 3. 超时兜底 → 强制停稳
 */
export function checkSettled(
  bodies: CANNON.Body[],
  currentTime: number,
  state: SettleState,
  world?: CANNON.World,
  contactClusterAssistEnabled = SETTLE.contactClusterAssist.enabled,
): boolean {
  if (world && contactClusterAssistEnabled) {
    applyContactClusterSettleAssist(
      world,
      bodies,
      currentTime,
      state.contactClusterAssist,
      state.startTime,
    )
  }

  // 路径 1：全部 body 进入 sleep
  if (bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING)) {
    return true
  }

  // 路径 3：超时兜底
  const elapsed = currentTime - state.startTime
  if (elapsed >= SETTLE.timeout) {
    return true
  }

  // 路径 2：速度阈值检测
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
      return true
    }
  } else {
    // 速度超过阈值，重置计时
    if (state.stableStartTime >= 0) state.stableBrokenCount++
    state.stableStartTime = -1
  }

  return false
}
