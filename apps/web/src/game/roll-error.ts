/**
 * 当前轮无法可信结算时的显式产品错误。
 *
 * 这里只承载诊断事实，不得包含骰面或奖级；controller 收到错误后必须冻结
 * 当前画面并保持同一轮，等待用户重新掷骰或重置。
 */
export type RollError =
  | {
      reason: 'timeout'
      /** 从本轮开始到超时的物理模拟时间（秒）。 */
      elapsed: number
    }
  | {
      reason: 'timing-overload'
      /** 进入过载错误时已经完成的物理模拟时间（秒）。 */
      simulationElapsed: number
      /** 尚未执行的物理时间队列（毫秒）。 */
      queuedMs: number
      /** 允许的物理时间队列高水位（毫秒）。 */
      highWaterMs: number
      /** 本轮已完整执行的固定物理步数。 */
      executedSteps: number
    }
