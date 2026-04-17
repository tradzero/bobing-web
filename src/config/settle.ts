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
  /**
   * 尾段接触簇辅助收敛
   * 仅用于 dice-dice 低速黏连：当少数活跃骰子长期形成单一接触簇、且其余骰子已基本停稳时，
   * 允许对该簇做一次性冻结，避免 stable window 被反复轻微碰撞打断。
   */
  contactClusterAssist: {
    enabled: true,
    /** 至少进入尾段一段时间后才允许介入，避免影响正常滚动过程 */
    activationDelay: 1.6,
    /** 接触簇需要连续维持多久才认为是真正“咬住”而不是瞬时擦碰 */
    persistenceDuration: 0.2,
    /** 只介入 2~4 颗骰子的局部接触簇，不碰更大范围的整体动态 */
    minClusterSize: 2,
    maxClusterSize: 4,
    /** 只有低速尾段才允许触发 */
    speedThreshold: 0.12,
    angularThreshold: 0.2,
    /** 接触双方相对线速度上限，限制在“轻微咬合”而非明显滚动碰撞 */
    relativeSpeedThreshold: 0.08,
  },
  /** 超时上限 (s)，超过后进入兜底结算 */
  timeout: 10.0,
  /** 倾斜可信度阈值 (cos θ)，低于此值进入确认态；0.75 ≈ 41.4° */
  tiltThreshold: 0.75,
} as const
