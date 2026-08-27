import { Prize, type JudgeResult } from '../rules/types'
import { isZhuangyuanPrize } from './awards'

export interface ZhuangyuanClaim {
  playerId: string
  rollId: string
  sequence: number
  diceValues: readonly number[]
  result: JudgeResult
}

export type ZhuangyuanClaims = Readonly<Record<string, ZhuangyuanClaim>>

function repeatedFace(result: JudgeResult): number {
  return result.prize === Prize.LiuZi ? (result.matchedDice[0] ?? 0) : 0
}

/**
 * 返回正数表示 a 大于 b。先比现有状元子级，同子级比带数，
 * 六子再比重复点数。完全相同返回 0，由早先的守擂者保留。
 */
export function compareZhuangyuanClaims(a: ZhuangyuanClaim, b: ZhuangyuanClaim): number {
  if (!isZhuangyuanPrize(a.result.prize) || !isZhuangyuanPrize(b.result.prize)) {
    throw new RangeError('抢状元比较只接受状元类判定结果')
  }

  if (a.result.priority !== b.result.priority) {
    return b.result.priority - a.result.priority
  }

  if (a.result.carryScore !== b.result.carryScore) {
    return a.result.carryScore - b.result.carryScore
  }

  const repeatedDifference = repeatedFace(a.result) - repeatedFace(b.result)
  if (repeatedDifference !== 0) return repeatedDifference
  return 0
}

/** 同一玩家只保留最后一次状元，即使新状元比旧状元小。 */
export function replacePlayerZhuangyuanClaim(
  claims: ZhuangyuanClaims,
  claim: ZhuangyuanClaim,
): Record<string, ZhuangyuanClaim> {
  if (!isZhuangyuanPrize(claim.result.prize)) {
    throw new RangeError('只有状元类结果可以写入抢状元记录')
  }
  return { ...claims, [claim.playerId]: { ...claim, diceValues: [...claim.diceValues] } }
}

export function selectZhuangyuanHolder(claims: ZhuangyuanClaims): ZhuangyuanClaim | null {
  let holder: ZhuangyuanClaim | null = null
  for (const claim of Object.values(claims)) {
    if (!holder) {
      holder = claim
      continue
    }

    const comparison = compareZhuangyuanClaims(claim, holder)
    if (comparison > 0 || (comparison === 0 && claim.sequence < holder.sequence)) {
      holder = claim
    }
  }
  return holder
}
