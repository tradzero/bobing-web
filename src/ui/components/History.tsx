import { useGameStore } from './GameStoreContext'
import { Prize } from '@/rules/types'
import { PRIZE_NAMES } from '@/rules/judge'
import { DiceFace } from './DiceFace'

/** 最近 N 轮历史记录 */
export function History() {
  const history = useGameStore((s) => s.history)

  if (history.length === 0) return null

  return (
    <div className="panel-card panel-card-history">
      <div className="panel-header">
        <div className="panel-title">历史记录</div>
        <div className="panel-subtitle">最近 5 轮</div>
      </div>
      <ul className="history-list">
        {history.map((entry, i) => (
          <li key={i} className="history-item">
            <div className="history-row">
              <span className="history-round">第{entry.round}轮</span>
              <span className="history-separator" aria-hidden="true">·</span>
              <span className="history-prize">
                {PRIZE_NAMES[entry.result.prize]}
              </span>
              {entry.result.prize === Prize.ZhuangYuan && entry.result.carryScore > 0 && (
                <span className="history-carry">带{entry.result.carryScore}</span>
              )}
            </div>
            <div className="history-dice">
              {entry.diceValues.map((value, diceIndex) => (
                <DiceFace
                  key={`${entry.round}-${diceIndex}`}
                  value={value}
                  mini
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
