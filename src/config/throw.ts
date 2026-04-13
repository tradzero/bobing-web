/**
 * 投掷参数集中配置
 */
export const THROW = {
  /** 初始高度范围 (m) */
  heightMin: 2.0,
  heightMax: 2.5,
  /** 水平散布半径 (m) */
  spreadRadius: 0.3,
  /** 向下初速度范围 (m/s) */
  downSpeedMin: -3.0,
  downSpeedMax: -1.5,
  /** 水平初速度范围 (m/s) - 向碗中心偏移 */
  horizontalSpeedMin: -0.5,
  horizontalSpeedMax: 0.5,
  /** 角速度范围 (rad/s) */
  angularSpeedMin: -15,
  angularSpeedMax: 15,
} as const
