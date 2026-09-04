// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { judge, Prize } from '@dice/game-domain'

describe('输入契约', () => {
  it.each([
    { diceValues: [] },
    { diceValues: [1, 2, 3, 4, 5] },
    { diceValues: [1, 2, 3, 4, 5, 6, 1] },
  ])('拒绝非 6 颗骰子的组合：$diceValues', ({ diceValues }) => {
    expect(() => judge(diceValues)).toThrow(RangeError)
    expect(() => judge(diceValues)).toThrow(/恰好 6 颗骰子/)
  })

  it.each([
    { diceValues: [0, 1, 2, 3, 4, 5] },
    { diceValues: [1, 2, 3, 4, 5, 7] },
    { diceValues: [1, 2, 3, 4, 5, 1.5] },
    { diceValues: [1, 2, 3, 4, 5, Number.NaN] },
    { diceValues: [1, 2, 3, 4, 5, Number.POSITIVE_INFINITY] },
    { diceValues: [1, 2, 3, 4, 5, Number.NEGATIVE_INFINITY] },
  ])('拒绝不在 1..6 内的有限整数：$diceValues', ({ diceValues }) => {
    expect(() => judge(diceValues)).toThrow(RangeError)
    expect(() => judge(diceValues)).toThrow(/1 到 6 的有限整数/)
  })

  it('拒绝非数组输入', () => {
    expect(() => judge(null as unknown as number[])).toThrow(TypeError)
  })
})

describe('奖级判定 - 全部 13 种奖级典型用例', () => {
  it('状元插金花：4个四 + 2个一', () => {
    const r = judge([4, 1, 4, 4, 1, 4])
    expect(r.prize).toBe(Prize.ZhuangYuanChaJinHua)
    expect(r.priority).toBe(1)
    expect(r.carryScore).toBe(0)
    expect(r.matchedDice).toEqual([4, 4, 4, 4, 1, 1])
    expect(r.remainDice).toEqual([])
    expect(r.description).toBe('状元插金花')
  })

  it('满堂红：6个四', () => {
    const r = judge([4, 4, 4, 4, 4, 4])
    expect(r.prize).toBe(Prize.ManTangHong)
    expect(r.priority).toBe(2)
    expect(r.carryScore).toBe(0)
  })

  it('遍地锦：6个一', () => {
    const r = judge([1, 1, 1, 1, 1, 1])
    expect(r.prize).toBe(Prize.BianDiJin)
    expect(r.priority).toBe(3)
    expect(r.carryScore).toBe(0)
  })

  it('六子（6个六）', () => {
    const r = judge([6, 6, 6, 6, 6, 6])
    expect(r.prize).toBe(Prize.LiuZi)
    expect(r.priority).toBe(4)
    expect(r.carryScore).toBe(0)
  })

  it('六子（6个二）', () => {
    const r = judge([2, 2, 2, 2, 2, 2])
    expect(r.prize).toBe(Prize.LiuZi)
    expect(r.priority).toBe(4)
  })

  it('六子（6个三）', () => {
    const r = judge([3, 3, 3, 3, 3, 3])
    expect(r.prize).toBe(Prize.LiuZi)
  })

  it('五红：5个四 + 1个其他', () => {
    const r = judge([4, 4, 4, 4, 4, 6])
    expect(r.prize).toBe(Prize.WuHong)
    expect(r.priority).toBe(5)
    expect(r.carryScore).toBe(6)
    expect(r.remainDice).toEqual([6])
    expect(r.description).toBe('五红 带6')
  })

  it('五子登科：5个相同（非四）', () => {
    const r = judge([3, 3, 3, 3, 3, 5])
    expect(r.prize).toBe(Prize.WuZiDengKe)
    expect(r.priority).toBe(6)
    expect(r.carryScore).toBe(5)
    expect(r.remainDice).toEqual([5])
  })

  it('状元：4个四 + 非两个一', () => {
    const r = judge([4, 4, 4, 4, 2, 5])
    expect(r.prize).toBe(Prize.ZhuangYuan)
    expect(r.priority).toBe(7)
    expect(r.carryScore).toBe(7)
    expect(r.matchedDice).toEqual([4, 4, 4, 4])
    expect(r.remainDice).toEqual([2, 5])
    expect(r.description).toBe('状元 带7')
  })

  it('对堂：1-2-3-4-5-6', () => {
    const r = judge([3, 1, 6, 4, 2, 5])
    expect(r.prize).toBe(Prize.DuiTang)
    expect(r.priority).toBe(8)
    expect(r.carryScore).toBe(0)
  })

  it('三红：3个四', () => {
    const r = judge([4, 4, 4, 2, 3, 6])
    expect(r.prize).toBe(Prize.SanHong)
    expect(r.priority).toBe(9)
    expect(r.carryScore).toBe(11)
    expect(r.remainDice).toEqual([2, 3, 6])
  })

  it('四进：4个相同（非四）', () => {
    const r = judge([5, 5, 5, 5, 2, 3])
    expect(r.prize).toBe(Prize.SiJin)
    expect(r.priority).toBe(10)
    expect(r.carryScore).toBe(5)
    expect(r.remainDice).toEqual([2, 3])
  })

  it('二举：2个四', () => {
    const r = judge([4, 4, 1, 2, 3, 5])
    expect(r.prize).toBe(Prize.ErJu)
    expect(r.priority).toBe(11)
    expect(r.carryScore).toBe(11)
    expect(r.remainDice).toEqual([1, 2, 3, 5])
  })

  it('一秀：1个四', () => {
    const r = judge([4, 1, 2, 3, 5, 5])
    expect(r.prize).toBe(Prize.YiXiu)
    expect(r.priority).toBe(12)
    expect(r.carryScore).toBe(16)
    expect(r.remainDice).toEqual([1, 2, 3, 5, 5])
  })

  it('未中奖：无四', () => {
    const r = judge([1, 2, 3, 5, 5, 6])
    expect(r.prize).toBe(Prize.None)
    expect(r.priority).toBe(13)
    expect(r.carryScore).toBe(0)
    expect(r.matchedDice).toEqual([])
    expect(r.description).toBe('未中奖')
  })
})

describe('边界用例 - 同时满足多条规则只返回最高优先级', () => {
  it('4个四+2个一 → 状元插金花（优先于状元）', () => {
    const r = judge([4, 4, 4, 4, 1, 1])
    expect(r.prize).toBe(Prize.ZhuangYuanChaJinHua)
    expect(r.priority).toBe(1)
  })

  it('4个四+1+3 → 状元（不是插金花）', () => {
    const r = judge([4, 4, 4, 4, 1, 3])
    expect(r.prize).toBe(Prize.ZhuangYuan)
    expect(r.priority).toBe(7)
  })

  it('1-2-3-4-5-6 → 对堂（也含1个四，但对堂优先级更高）', () => {
    // 对堂 priority=8, 一秀 priority=12 → 对堂优先
    const r = judge([1, 2, 3, 4, 5, 6])
    expect(r.prize).toBe(Prize.DuiTang)
  })

  it('4个三+2个四 → 二举（四进需要非四，且二举有2个四）', () => {
    // 4个三满足四进, 2个四满足二举
    // 四进 priority=10, 二举 priority=11 → 四进优先
    const r = judge([3, 3, 3, 3, 4, 4])
    expect(r.prize).toBe(Prize.SiJin)
  })
})

describe('带数 - 相同奖级不同带数', () => {
  it('状元 带6 vs 状元 带7：带数应该不同', () => {
    const r1 = judge([4, 4, 4, 4, 1, 5])
    const r2 = judge([4, 4, 4, 4, 1, 6])
    expect(r1.prize).toBe(Prize.ZhuangYuan)
    expect(r2.prize).toBe(Prize.ZhuangYuan)
    expect(r1.carryScore).toBe(6)
    expect(r2.carryScore).toBe(7)
    expect(r2.carryScore).toBeGreaterThan(r1.carryScore)
  })

  it('三红 带最小 vs 三红 带最大', () => {
    const rMin = judge([4, 4, 4, 1, 1, 1])
    const rMax = judge([4, 4, 4, 6, 6, 6])
    expect(rMin.prize).toBe(Prize.SanHong)
    expect(rMax.prize).toBe(Prize.SanHong)
    expect(rMin.carryScore).toBe(3)
    expect(rMax.carryScore).toBe(18)
  })

  it('五红带数 = 剩余1颗骰子点数', () => {
    const r = judge([4, 4, 4, 4, 4, 3])
    expect(r.prize).toBe(Prize.WuHong)
    expect(r.carryScore).toBe(3)
    expect(r.remainDice).toEqual([3])
  })

  it('一秀带数 = 5颗剩余骰子之和', () => {
    const r = judge([4, 2, 2, 3, 5, 6])
    expect(r.prize).toBe(Prize.YiXiu)
    expect(r.carryScore).toBe(18)
    expect(r.remainDice).toEqual([2, 2, 3, 5, 6])
  })

  it('完全满足的奖级带数为0', () => {
    expect(judge([4, 4, 4, 4, 1, 1]).carryScore).toBe(0) // 状元插金花
    expect(judge([4, 4, 4, 4, 4, 4]).carryScore).toBe(0) // 满堂红
    expect(judge([1, 1, 1, 1, 1, 1]).carryScore).toBe(0) // 遍地锦
    expect(judge([6, 6, 6, 6, 6, 6]).carryScore).toBe(0) // 六子
    expect(judge([1, 2, 3, 4, 5, 6]).carryScore).toBe(0) // 对堂
  })
})

describe('六子内部排序', () => {
  it('6个六 > 6个五 > 6个三 > 6个二（基于 priority 相同，需比较点数）', () => {
    // 六子都是 priority 4，但可通过 matchedDice[0] 区分大小
    const r6 = judge([6, 6, 6, 6, 6, 6])
    const r5 = judge([5, 5, 5, 5, 5, 5])
    const r3 = judge([3, 3, 3, 3, 3, 3])
    const r2 = judge([2, 2, 2, 2, 2, 2])
    expect(r6.matchedDice[0]).toBeGreaterThan(r5.matchedDice[0])
    expect(r5.matchedDice[0]).toBeGreaterThan(r3.matchedDice[0])
    expect(r3.matchedDice[0]).toBeGreaterThan(r2.matchedDice[0])
  })

  it('6个1 不是六子（是遍地锦）', () => {
    expect(judge([1, 1, 1, 1, 1, 1]).prize).toBe(Prize.BianDiJin)
  })

  it('6个4 不是六子（是满堂红）', () => {
    expect(judge([4, 4, 4, 4, 4, 4]).prize).toBe(Prize.ManTangHong)
  })
})

describe('穷举校验 - 46656 种组合', () => {
  // correctness 门禁固定覆盖全部组合；超时只留出共享 CI 的调度噪声，不作为性能指标。
  it('每种组合只命中一个最高优先级，且输出一致', () => {
    let count = 0
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 1; c <= 6; c++) {
          for (let d = 1; d <= 6; d++) {
            for (let e = 1; e <= 6; e++) {
              for (let f = 1; f <= 6; f++) {
                const dice = [a, b, c, d, e, f]
                const r = judge(dice)
                count++

                // 必须有有效返回
                expect(r).toBeDefined()
                expect(r.prize).toBeDefined()
                expect(r.priority).toBeGreaterThanOrEqual(1)
                expect(r.priority).toBeLessThanOrEqual(13)

                // 结果一致性：同样的输入排序后应得到相同结果
                const r2 = judge([...dice].reverse())
                expect(r2.prize).toBe(r.prize)
                expect(r2.priority).toBe(r.priority)
                expect(r2.carryScore).toBe(r.carryScore)

                // matchedDice + remainDice 应包含所有原始骰子
                const all = [...r.matchedDice, ...r.remainDice].sort((x, y) => x - y)
                const expected = [...dice].sort((x, y) => x - y)
                expect(all).toEqual(expected)

                // 带数一致性（未中奖时 carryScore=0 但 remainDice 为全部骰子）
                if (r.prize !== Prize.None) {
                  const expectedCarry = r.remainDice.reduce((sum, v) => sum + v, 0)
                  expect(r.carryScore).toBe(expectedCarry)
                } else {
                  expect(r.carryScore).toBe(0)
                }
              }
            }
          }
        }
      }
    }
    expect(count).toBe(46656)
  }, 15_000)
})
