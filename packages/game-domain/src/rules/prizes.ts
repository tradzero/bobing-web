import { Prize, type PrizeRule } from './types'

/**
 * 辅助：统计各点数出现次数
 */
function countDice(sorted: number[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const v of sorted) {
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  return counts
}

/**
 * 辅助：从 sorted 中移除指定点数 n 个，返回剩余数组
 */
function removeN(sorted: number[], value: number, n: number): number[] {
  const remain = [...sorted]
  let removed = 0
  for (let i = remain.length - 1; i >= 0 && removed < n; i--) {
    if (remain[i] === value) {
      remain.splice(i, 1)
      removed++
    }
  }
  return remain
}

/**
 * 博饼奖级规则表
 * 按 priority 升序排列（数值越小优先级越高，排在前面）
 * 判定时从头遍历，遇到第一个匹配即返回
 */
export const PRIZE_RULES: PrizeRule[] = [
  // priority 1：状元插金花 — 4个四 + 2个一
  {
    prize: Prize.ZhuangYuanChaJinHua,
    name: '状元插金花',
    priority: 1,
    match(sorted) {
      const counts = countDice(sorted)
      if (counts.get(4) === 4 && counts.get(1) === 2) {
        return [[4, 4, 4, 4, 1, 1], []]
      }
      return null
    },
  },

  // priority 2：满堂红 — 6个四
  {
    prize: Prize.ManTangHong,
    name: '满堂红',
    priority: 2,
    match(sorted) {
      if (sorted.every((v) => v === 4)) {
        return [[4, 4, 4, 4, 4, 4], []]
      }
      return null
    },
  },

  // priority 3：遍地锦 — 6个一
  {
    prize: Prize.BianDiJin,
    name: '遍地锦',
    priority: 3,
    match(sorted) {
      if (sorted.every((v) => v === 1)) {
        return [[1, 1, 1, 1, 1, 1], []]
      }
      return null
    },
  },

  // priority 4：六子 — 6个相同（非四非一），按点数排序 6 最大 2 最小
  {
    prize: Prize.LiuZi,
    name: '六子',
    priority: 4,
    match(sorted) {
      const v = sorted[0]
      if (v !== 1 && v !== 4 && sorted.every((d) => d === v)) {
        return [sorted.slice(), []]
      }
      return null
    },
  },

  // priority 5：五红 — 5个四
  {
    prize: Prize.WuHong,
    name: '五红',
    priority: 5,
    match(sorted) {
      const counts = countDice(sorted)
      if (counts.get(4) === 5) {
        const remain = removeN(sorted, 4, 5)
        return [[4, 4, 4, 4, 4], remain]
      }
      return null
    },
  },

  // priority 6：五子登科 — 5个相同（非四）
  {
    prize: Prize.WuZiDengKe,
    name: '五子登科',
    priority: 6,
    match(sorted) {
      const counts = countDice(sorted)
      for (const [value, count] of counts) {
        if (value !== 4 && count === 5) {
          const remain = removeN(sorted, value, 5)
          return [Array(5).fill(value), remain]
        }
      }
      return null
    },
  },

  // priority 7：状元 — 4个四（不满足插金花条件）
  {
    prize: Prize.ZhuangYuan,
    name: '状元',
    priority: 7,
    match(sorted) {
      const counts = countDice(sorted)
      if (counts.get(4) === 4) {
        const remain = removeN(sorted, 4, 4)
        return [[4, 4, 4, 4], remain]
      }
      return null
    },
  },

  // priority 8：对堂 — 1-2-3-4-5-6 各一
  {
    prize: Prize.DuiTang,
    name: '对堂',
    priority: 8,
    match(sorted) {
      if (
        sorted.length === 6 &&
        sorted[0] === 1 &&
        sorted[1] === 2 &&
        sorted[2] === 3 &&
        sorted[3] === 4 &&
        sorted[4] === 5 &&
        sorted[5] === 6
      ) {
        return [[1, 2, 3, 4, 5, 6], []]
      }
      return null
    },
  },

  // priority 9：三红 — 3个四
  {
    prize: Prize.SanHong,
    name: '三红',
    priority: 9,
    match(sorted) {
      const counts = countDice(sorted)
      if (counts.get(4) === 3) {
        const remain = removeN(sorted, 4, 3)
        return [[4, 4, 4], remain]
      }
      return null
    },
  },

  // priority 10：四进 — 4个相同（非四）
  {
    prize: Prize.SiJin,
    name: '四进',
    priority: 10,
    match(sorted) {
      const counts = countDice(sorted)
      for (const [value, count] of counts) {
        if (value !== 4 && count === 4) {
          const remain = removeN(sorted, value, 4)
          return [Array(4).fill(value), remain]
        }
      }
      return null
    },
  },

  // priority 11：二举 — 2个四
  {
    prize: Prize.ErJu,
    name: '二举',
    priority: 11,
    match(sorted) {
      const counts = countDice(sorted)
      if (counts.get(4) === 2) {
        const remain = removeN(sorted, 4, 2)
        return [[4, 4], remain]
      }
      return null
    },
  },

  // priority 12：一秀 — 1个四
  {
    prize: Prize.YiXiu,
    name: '一秀',
    priority: 12,
    match(sorted) {
      const counts = countDice(sorted)
      if (counts.get(4) === 1) {
        const remain = removeN(sorted, 4, 1)
        return [[4], remain]
      }
      return null
    },
  },
]
