/**
 * 停稳检测参数集中配置
 */
export const SETTLE = {
  /** 线速度阈值 (m/s) */
  speedThreshold: 0.05,
  /** 角速度阈值 (rad/s) */
  angularThreshold: 0.05,
  /** 持续低于阈值的时间 (s) */
  stableDuration: 0.5,
  /** 超时上限 (s)，超过后进入兜底结算 */
  timeout: 10.0,
  /** 倾斜可信度阈值 (cos θ)，低于此值进入确认态；0.85 ≈ 31.8° */
  tiltThreshold: 0.85,
} as const
