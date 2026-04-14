import { useGameStore } from './GameStoreContext'
import { Prize } from '@/rules/types'
import { PRIZE_NAMES } from '@/rules/judge'

/** 需要显示的奖级列表（排除"未中奖"） */
const DISPLAY_PRIZES = Object.values(Prize).filter((p) => p !== Prize.None)

/** 累计奖级记录面板 */
export function PrizeRecord() {
  const prizeRecord = useGameStore((s) => s.prizeRecord)

  const hasAny = DISPLAY_PRIZES.some((p) => prizeRecord[p] > 0)
  if (!hasAny) return null

  return (
    <div className="panel-card">
      <div className="panel-title">奖级统计</div>
      <ul className="prize-list">
        {DISPLAY_PRIZES.map((p) => {
          const count = prizeRecord[p] ?? 0
          if (count === 0) return null
          return (
            <li key={p} className="prize-item">
              <span>{PRIZE_NAMES[p]}</span>
              <span className="count">×{count}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
