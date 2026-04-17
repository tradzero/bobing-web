/**
 * 物理参数集中配置
 * 所有参数以实际调试表现为准，此处为初始值
 */
export const PHYSICS = {
  /** 重力加速度 (m/s²) */
  gravity: -9.82,
  /** 固定时间步长 (s) */
  fixedTimeStep: 1 / 60,
  /** 最大子步进数 */
  maxSubSteps: 8,

  /** 骰子质量 (kg) */
  diceMass: 0.03,
  /** 骰子半尺寸（立方体边长的一半） */
  diceHalfSize: 0.12,
  /** 骰子倒角比例（0 = Box 回退，>0 = 截角立方体凸包） */
  diceChamferRatio: 0.15,
  /** 骰子线性阻尼（chamfer 倒角后骰子更易滚动，从 0.30 提升到 0.35 补偿） */
  diceLinearDamping: 0.35,
  /** 骰子角阻尼（同步提升，配合线性阻尼减少 timeout 率） */
  diceAngularDamping: 0.35,

  /** 骰子 sleep 相关（收紧：低 speedLimit + 适中 timeLimit，平衡结算速度与斜停风险） */
  diceSleepSpeedLimit: 0.20,
  diceSleepTimeLimit: 0.32,

  /** 接触材质参数 */
  contact: {
    /** 骰子-碗（bowlMaterial 同时用于碗底与墙壁，适度摩擦让骰子滑向平稳位置） */
    diceBowl: { friction: 0.28, restitution: 0.15 },
    /** 骰子-骰子（restitution 0.25→0.20：减少碰撞弹性，修复已知 tilt seed 的棱角互锁） */
    diceDice: { friction: 0.3, restitution: 0.20 },
    /** 骰子-桌面 */
    diceTable: { friction: 0.5, restitution: 0.2 },
  },
} as const
