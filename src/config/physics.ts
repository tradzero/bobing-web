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
  /** GSSolver 默认迭代次数；越高每步求解越充分，但成本更高，且不一定改善长尾 */
  solverIterations: 10,
  /** GSSolver 默认收敛容差；越小越严格，通常只做细调 */
  solverTolerance: 1e-7,

  /** 骰子质量 (kg) */
  diceMass: 0.03,
  /** 骰子半尺寸（立方体边长的一半） */
  diceHalfSize: 0.12,
  /** 骰子倒角比例（当前默认 0 = 运行时回退 Box；>0 时启用截角立方体凸包） */
  diceChamferRatio: 0,
  /** 骰子线性阻尼（保留 0.35，便于与既有 box/chamfer sweep 结果对齐） */
  diceLinearDamping: 0.35,
  /** 骰子角阻尼（与线性阻尼保持一致，减少长尾结算） */
  diceAngularDamping: 0.35,

  /** 骰子 sleep 相关（收紧：低 speedLimit + 适中 timeLimit，平衡结算速度与斜停风险） */
  diceSleepSpeedLimit: 0.2,
  diceSleepTimeLimit: 0.32,

  /**
   * 接触材质参数
   * - friction / restitution: 常规摩擦与弹性
   * - contactEquationStiffness: 法向接触“硬度”，越大越硬，过高时低速接触更容易出现硬碰硬长尾
   * - contactEquationRelaxation: 法向接触误差衰减速度，适当提高可减少低速黏连与 stable window 反复打破
   * - frictionEquationStiffness: 切向摩擦约束硬度，越大越“咬住”，过高会增加互锁/斜停风险
   * - frictionEquationRelaxation: 切向摩擦误差衰减速度，越大越容易滑开，过高会损失手感
   */
  contact: {
    /** 骰子-碗底 Heightfield（独立于碗壁，便于单独调 restitution 减少碗底弹跳） */
    diceFloor: {
      friction: 0.28,
      restitution: 0.15,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3,
      frictionEquationStiffness: 1e7,
      frictionEquationRelaxation: 3,
    },
    /** 骰子-碗壁挡墙（独立于碗底，保留回弹手感） */
    diceWall: {
      friction: 0.28,
      restitution: 0.15,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3,
      frictionEquationStiffness: 1e7,
      frictionEquationRelaxation: 3,
    },
    /** 骰子-骰子（0.22 是当前弹性折中值；接触方程做了低速黏连收敛优化） */
    diceDice: {
      friction: 0.3,
      restitution: 0.22,
      // sweep 验证表明 r=6 是关键改善维度；stiffness 在 4e6-8e6 间差异很小，取中间值 6e6。
      contactEquationStiffness: 6e6,
      contactEquationRelaxation: 6,
      frictionEquationStiffness: 1e7,
      frictionEquationRelaxation: 3,
    },
    /** 骰子-桌面 */
    diceTable: {
      friction: 0.5,
      restitution: 0.2,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3,
      frictionEquationStiffness: 1e7,
      frictionEquationRelaxation: 3,
    },
  },
} as const
