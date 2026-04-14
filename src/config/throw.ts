/**
 * 投掷参数集中配置
 */
export const THROW = {
  /** 初始高度范围 (m) */
  heightMin: 1.2,
  heightMax: 1.6,
  /** 水平散布半径 (m) */
  spreadRadius: 0.55,
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
