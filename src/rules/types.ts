/**
 * 博饼奖级枚举
 * 按优先级从高到低排列（数值越小优先级越高）
 */
export enum Prize {
  /** 状元插金花：4个四 + 2个一 */
  ZhuangYuanChaJinHua = 'zhuangyuan_chajinhua',
  /** 满堂红：6个四 */
  ManTangHong = 'mantanghong',
  /** 遍地锦：6个一 */
  BianDiJin = 'biandijin',
  /** 六子：6个相同（非四非一） */
  LiuZi = 'liuzi',
  /** 五红：5个四 */
  WuHong = 'wuhong',
  /** 五子登科：5个相同（非四） */
  WuZiDengKe = 'wuzidengke',
  /** 状元：4个四（不满足插金花） */
  ZhuangYuan = 'zhuangyuan',
  /** 对堂：1-2-3-4-5-6各一 */
  DuiTang = 'duitang',
  /** 三红：3个四 */
  SanHong = 'sanhong',
  /** 四进：4个相同（非四） */
  SiJin = 'sijin',
  /** 二举：2个四 */
  ErJu = 'erju',
  /** 一秀：1个四 */
  YiXiu = 'yixiu',
  /** 未中奖 */
  None = 'none',
}

/** 判定结果完整对象 */
export interface JudgeResult {
  /** 奖级枚举 */
  prize: Prize
  /** 优先级数值（越小越高） */
  priority: number
  /** 带数（剩余骰子之和，无带数时为 0） */
  carryScore: number
  /** 命中规则的骰子点数 */
  matchedDice: number[]
  /** 剩余骰子点数 */
  remainDice: number[]
  /** 人类可读描述 */
  description: string
}

/**
 * 奖级规则数据结构
 * match 函数接收已排序的 6 颗骰子点数，返回 [命中骰子, 剩余骰子] 或 null
 */
export interface PrizeRule {
  prize: Prize
  /** 奖级中文名 */
  name: string
  /** 优先级数值（越小越高，排在前面） */
  priority: number
  /** 匹配函数：返回 [matchedDice, remainDice] 或 null */
  match: (sorted: number[]) => [matched: number[], remain: number[]] | null
}
