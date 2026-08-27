// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  AwardTier,
  INITIAL_PRIZE_POOL,
  Prize,
  allocateAward,
  awardTierForResult,
  countPrizePool,
  createBonusRoundQueue,
  createPrizePool,
  isPrizePoolDepleted,
  judge,
  replacePlayerZhuangyuanClaim,
  selectZhuangyuanHolder,
  type ZhuangyuanClaim,
} from '..'

function claim(playerId: string, sequence: number, diceValues: number[]): ZhuangyuanClaim {
  return {
    playerId,
    sequence,
    rollId: `roll-${sequence}`,
    diceValues,
    result: judge(diceValues),
  }
}

describe('63 份实体奖池', () => {
  it('按 1/2/4/8/16/32 初始化且总数为 63', () => {
    expect(INITIAL_PRIZE_POOL).toEqual({
      zhuangyuan: 1,
      duitang: 2,
      sanhong: 4,
      sijin: 8,
      erju: 16,
      yixiu: 32,
    })
    expect(countPrizePool(createPrizePool())).toBe(63)
  })

  it('七种状元子级均映射到唯一状元席位', () => {
    const outcomes = [
      [4, 4, 4, 4, 1, 1],
      [4, 4, 4, 4, 4, 4],
      [1, 1, 1, 1, 1, 1],
      [6, 6, 6, 6, 6, 6],
      [4, 4, 4, 4, 4, 6],
      [5, 5, 5, 5, 5, 6],
      [4, 4, 4, 4, 2, 6],
    ]

    for (const dice of outcomes) {
      expect(awardTierForResult(judge(dice))).toBe(AwardTier.ZhuangYuan)
    }
  })

  it('普通奖项只在有库存时扣减，空库存不会出现负数', () => {
    const initial = createPrizePool()
    const first = allocateAward(initial, judge([1, 2, 3, 4, 5, 5]))
    expect(first).toMatchObject({ tier: AwardTier.YiXiu, granted: true, reason: 'granted' })
    expect(first.pool.yixiu).toBe(31)
    expect(initial.yixiu).toBe(32)

    const empty = { ...initial, yixiu: 0 }
    const exhausted = allocateAward(empty, judge([1, 2, 3, 4, 5, 5]))
    expect(exhausted).toMatchObject({ granted: false, reason: 'out-of-stock' })
    expect(exhausted.pool.yixiu).toBe(0)
  })

  it('状元席位被首次命中后记为已占用', () => {
    const allocation = allocateAward(createPrizePool(), judge([4, 4, 4, 4, 2, 6]))
    expect(allocation.reason).toBe('zhuangyuan-claim')
    expect(allocation.pool.zhuangyuan).toBe(0)
  })

  it('全部计数为零且有状元归属时才算博完', () => {
    const empty = Object.fromEntries(
      Object.keys(INITIAL_PRIZE_POOL).map((tier) => [tier, 0]),
    ) as Record<AwardTier, number>
    expect(isPrizePoolDepleted(empty, false)).toBe(false)
    expect(isPrizePoolDepleted(empty, true)).toBe(true)
    expect(isPrizePoolDepleted({ ...empty, erju: 1 }, true)).toBe(false)
  })
})

describe('抢状元', () => {
  it('按现有状元子级选出更大的记录', () => {
    const ordinary = claim('a', 1, [4, 4, 4, 4, 2, 6])
    const fiveRed = claim('b', 2, [4, 4, 4, 4, 4, 1])
    const claims = replacePlayerZhuangyuanClaim(replacePlayerZhuangyuanClaim({}, ordinary), fiveRed)
    expect(selectZhuangyuanHolder(claims)?.playerId).toBe('b')
  })

  it('同一玩家以最后一次状元为准，变小后会重新计算全局状元', () => {
    let claims = replacePlayerZhuangyuanClaim({}, claim('a', 1, [4, 4, 4, 4, 4, 1]))
    claims = replacePlayerZhuangyuanClaim(claims, claim('b', 2, [4, 4, 4, 4, 3, 6]))
    expect(selectZhuangyuanHolder(claims)?.playerId).toBe('a')

    claims = replacePlayerZhuangyuanClaim(claims, claim('a', 3, [4, 4, 4, 4, 1, 2]))
    expect(selectZhuangyuanHolder(claims)?.playerId).toBe('b')
  })

  it('完全相同时由早先记录的玩家守擂', () => {
    const dice = [4, 4, 4, 4, 2, 6]
    const claims = {
      later: claim('later', 10, dice),
      earlier: claim('earlier', 3, dice),
    }
    expect(selectZhuangyuanHolder(claims)?.playerId).toBe('earlier')
  })

  it('非状元结果不能写入状元记录', () => {
    expect(() => replacePlayerZhuangyuanClaim({}, claim('a', 1, [1, 2, 3, 4, 5, 6]))).toThrow(
      RangeError,
    )
    expect(judge([1, 2, 3, 4, 5, 6]).prize).toBe(Prize.DuiTang)
  })
})

describe('多人顺序', () => {
  const players = [
    { id: 'a', seat: 0 },
    { id: 'b', seat: 1 },
    { id: 'c', seat: 2 },
  ]

  it('加赛从博完者的下一座开始，博完者最后投', () => {
    expect(createBonusRoundQueue(players, 'b')).toEqual(['c', 'a', 'b'])
  })
})
