import { Prize, type JudgeResult } from '../rules/types'

/** 实体奖品只有六档；状元子级仍由 JudgeResult 完整保留。 */
export const AwardTier = {
  ZhuangYuan: 'zhuangyuan',
  DuiTang: 'duitang',
  SanHong: 'sanhong',
  SiJin: 'sijin',
  ErJu: 'erju',
  YiXiu: 'yixiu',
} as const

export type AwardTier = (typeof AwardTier)[keyof typeof AwardTier]

export type PrizePoolCounts = Record<AwardTier, number>

export const INITIAL_PRIZE_POOL: Readonly<PrizePoolCounts> = Object.freeze({
  [AwardTier.ZhuangYuan]: 1,
  [AwardTier.DuiTang]: 2,
  [AwardTier.SanHong]: 4,
  [AwardTier.SiJin]: 8,
  [AwardTier.ErJu]: 16,
  [AwardTier.YiXiu]: 32,
})

const ZHUANGYUAN_PRIZES = new Set<Prize>([
  Prize.ZhuangYuanChaJinHua,
  Prize.ManTangHong,
  Prize.BianDiJin,
  Prize.LiuZi,
  Prize.WuHong,
  Prize.WuZiDengKe,
  Prize.ZhuangYuan,
])

export function createPrizePool(): PrizePoolCounts {
  return { ...INITIAL_PRIZE_POOL }
}

export function countPrizePool(pool: Readonly<PrizePoolCounts>): number {
  return Object.values(pool).reduce((total, count) => total + count, 0)
}

export function isZhuangyuanPrize(prize: Prize): boolean {
  return ZHUANGYUAN_PRIZES.has(prize)
}

export function awardTierForResult(result: JudgeResult): AwardTier | null {
  if (isZhuangyuanPrize(result.prize)) return AwardTier.ZhuangYuan

  switch (result.prize) {
    case Prize.DuiTang:
      return AwardTier.DuiTang
    case Prize.SanHong:
      return AwardTier.SanHong
    case Prize.SiJin:
      return AwardTier.SiJin
    case Prize.ErJu:
      return AwardTier.ErJu
    case Prize.YiXiu:
      return AwardTier.YiXiu
    case Prize.None:
      return null
    default:
      throw new RangeError(`未知的博饼奖级：${String(result.prize)}`)
  }
}

export interface AwardAllocation {
  tier: AwardTier | null
  granted: boolean
  pool: PrizePoolCounts
  reason: 'granted' | 'no-prize' | 'out-of-stock' | 'zhuangyuan-claim'
}

/**
 * 普通奖项在有库存时扣减一份。状元是可被抢占的唯一席位，
 * 具体归属由 zhuangyuan 模块计算，这里不直接扣成不可逆的领取记录。
 */
export function allocateAward(
  pool: Readonly<PrizePoolCounts>,
  result: JudgeResult,
): AwardAllocation {
  const tier = awardTierForResult(result)
  if (!tier) return { tier: null, granted: false, pool: { ...pool }, reason: 'no-prize' }

  if (tier === AwardTier.ZhuangYuan) {
    return {
      tier,
      granted: true,
      pool: { ...pool, [AwardTier.ZhuangYuan]: 0 },
      reason: 'zhuangyuan-claim',
    }
  }

  if (pool[tier] <= 0) {
    return { tier, granted: false, pool: { ...pool }, reason: 'out-of-stock' }
  }

  return {
    tier,
    granted: true,
    pool: { ...pool, [tier]: pool[tier] - 1 },
    reason: 'granted',
  }
}

/** 状元已有当前归属，且其余 62 份实体奖品均已领完。 */
export function isPrizePoolDepleted(
  pool: Readonly<PrizePoolCounts>,
  hasZhuangyuanHolder: boolean,
): boolean {
  if (!hasZhuangyuanHolder) return false
  return Object.values(pool).every((remaining) => remaining === 0)
}
