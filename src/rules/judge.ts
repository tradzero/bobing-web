import { Prize, type JudgeResult } from './types'
import { PRIZE_RULES } from './prizes'

/** 奖级中文名映射 */
export const PRIZE_NAMES: Record<Prize, string> = {
  [Prize.ZhuangYuanChaJinHua]: '状元插金花',
  [Prize.ManTangHong]: '满堂红',
  [Prize.BianDiJin]: '遍地锦',
  [Prize.LiuZi]: '六子',
  [Prize.WuHong]: '五红',
  [Prize.WuZiDengKe]: '五子登科',
  [Prize.ZhuangYuan]: '状元',
  [Prize.DuiTang]: '对堂',
  [Prize.SanHong]: '三红',
  [Prize.SiJin]: '四进',
  [Prize.ErJu]: '二举',
  [Prize.YiXiu]: '一秀',
  [Prize.None]: '未中奖',
}

/**
 * 生成人类可读描述
 */
function buildDescription(name: string, carryScore: number): string {
  if (carryScore > 0) {
    return `${name} 带${carryScore}`
  }
  return name
}

/**
 * 博饼奖级判定函数
 * 输入 6 个骰子点数（1-6），输出完整 JudgeResult
 * 按规则表 priority 升序遍历，命中第一个即返回
 */
export function judge(diceValues: number[]): JudgeResult {
  // 排序副本，用于规则匹配
  const sorted = [...diceValues].sort((a, b) => a - b)

  for (const rule of PRIZE_RULES) {
    const result = rule.match(sorted)
    if (result !== null) {
      const [matchedDice, remainDice] = result
      const carryScore = remainDice.reduce((sum, v) => sum + v, 0)
      return {
        prize: rule.prize,
        priority: rule.priority,
        carryScore,
        matchedDice,
        remainDice,
        description: buildDescription(rule.name, carryScore),
      }
    }
  }

  // 未命中任何规则
  return {
    prize: Prize.None,
    priority: 13,
    carryScore: 0,
    matchedDice: [],
    remainDice: sorted,
    description: PRIZE_NAMES[Prize.None],
  }
}
