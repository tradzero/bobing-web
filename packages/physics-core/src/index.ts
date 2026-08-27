/**
 * 过渡期共享边界：服务端只从这里使用无 DOM 的 headless 物理。
 * 渲染层仍位于 apps/web，后续可将下列模块机械迁入本 package。
 */
export {
  ROLL_DIAGNOSTICS_SCHEMA_VERSION,
  runRoll,
  serializeRollResult,
  type RollRunResult,
} from '../../../apps/web/src/physics/roll-runner'
export { THROW_ALGORITHM_VERSION } from '../../../apps/web/src/dice/throw'
export { SETTLE_ALGORITHM_VERSION } from '../../../apps/web/src/dice/settle'
