import { PHYSICS } from './physics'

/**
 * 投掷参数集中配置
 */
export const THROW = {
  /** 初始高度范围 (m) */
  heightMin: 1.2,
  heightMax: 1.6,
  /** 水平散布半径 (m) */
  spreadRadius: 0.55,
  /** 骰子初始最小分离距离 (m)
   * 基于包围球半径保证：任意旋转下两颗立方体不相交
   * 包围球半径 = halfSize * sqrt(3)，两颗不交 = 2 * 包围球半径 + 安全余量
   */
  minSeparation: PHYSICS.diceHalfSize * 2 * Math.sqrt(3) + 0.02,
  /** 去重最大重试次数，超出后进入确定性 fallback */
  maxPlacementAttempts: 30,
  /** 向下初速度范围 (m/s) */
  downSpeedMin: -2.0,
  downSpeedMax: -1.0,
  /** 水平初速度范围 (m/s) - 向碗中心偏移 */
  horizontalSpeedMin: -0.3,
  horizontalSpeedMax: 0.3,
  /** 角速度范围 (rad/s) */
  angularSpeedMin: -10,
  angularSpeedMax: 10,
} as const
