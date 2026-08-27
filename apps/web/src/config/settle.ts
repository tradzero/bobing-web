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
   * 只读姿态稳定窗口：处理速度受离散接触面微冲量污染、但空间姿态持续不变的尾段。
   * 该检测不清速度、不修改四元数，结算原因单独记录。
   */
  poseStableWindow: {
    enabled: true,
    activationDelay: 1.2,
    duration: 0.75,
    maxPositionDrift: 0.002,
    maxAngularDrift: 0.015,
  },
  /**
   * 尾段接触簇辅助收敛
   * 仅用于 dice-dice 低速黏连：当少数活跃骰子长期形成单一接触簇、且其余骰子已基本停稳时，
   * 历史 A/B 可显式开启；运行时默认关闭，避免以清速度 + sleep 截断自然终态。
   */
  contactClusterAssist: {
    /** 历史算法能力保留，供显式 A/B variant 调用；不代表运行时默认启用。 */
    enabled: true,
    /** `checkSettled()` 未显式传 variant 时使用的运行时默认值。 */
    defaultEnabled: false,
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
