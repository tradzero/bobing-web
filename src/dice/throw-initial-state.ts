import type * as CANNON from 'cannon-es'
import {
  CANONICAL_BODY_STATE_VERSION,
  captureCanonicalBodyState,
  cloneCanonicalBodyState,
  type CanonicalBodyState,
  type CanonicalBodyStateDiagnostics,
} from './canonical-body-state'

/** 初始刚体状态的字段、顺序或字节编码变化时必须递增。 */
export const THROW_INITIAL_STATE_VERSION = CANONICAL_BODY_STATE_VERSION

/** 兼容既有浏览器 diagnostics public API。 */
export type ThrowInitialBodyState = CanonicalBodyState
export type ThrowInitialStateDiagnostics = CanonicalBodyStateDiagnostics

/**
 * throwDice() 返回后立即只读捕获；输入顺序就是 A/B 的 canonical dice body 顺序。
 * 此函数不唤醒 body、不写物理字段，也不消费随机数。
 */
export function captureThrowInitialState(
  bodies: readonly CANNON.Body[],
): ThrowInitialStateDiagnostics {
  return captureCanonicalBodyState(bodies)
}

/** controller 对外返回防御副本，避免诊断消费者改写下一份 post-render 快照。 */
export function cloneThrowInitialState(
  state: ThrowInitialStateDiagnostics,
): ThrowInitialStateDiagnostics {
  return cloneCanonicalBodyState(state)
}
