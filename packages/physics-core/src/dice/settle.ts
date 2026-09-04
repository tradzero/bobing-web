import * as CANNON from 'cannon-es'
import { SETTLE } from '../config/settle'
import { applyContactClusterSettleAssist } from './contact-cluster-assist'
import { checkSettledRuntime, type SettleResult, type SettleState } from './settle-runtime'

export {
  SETTLE_ALGORITHM_VERSION,
  createSettleState,
  type ContactClusterAssistState,
  type SettleReason,
  type SettleResult,
  type SettleState,
} from './settle-runtime'

/**
 * 物理实验入口。生产构建会映射到 settle-runtime；只有 lab/test 显式允许历史
 * contact-cluster assist，以继续复现既有 A/B 证据。
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
  return checkSettledRuntime(bodies, currentTime, state, poseStableWindowEnabled)
}
