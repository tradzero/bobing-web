import { useGameStore } from './GameStoreContext'
import { Prize } from '@/rules/types'
import { PRIZE_NAMES } from '@/rules/judge'

/** 最近 N 轮历史记录 */
export function History() {
  const history = useGameStore((s) => s.history)

  if (history.length === 0) return null

  return (
    <div className="panel-card">
      <div className="panel-title">历史记录</div>
      <ul className="history-list">
        {history.map((entry, i) => (
          <li key={i} className="history-item">
            <span className="history-round">第{entry.round}轮</span>
            <span className="history-prize">
              {PRIZE_NAMES[entry.result.prize]}
            </span>
            {entry.result.prize === Prize.ZhuangYuan && entry.result.carryScore > 0 && (
              <span className="history-dice"> 带{entry.result.carryScore}</span>
            )}
            <div className="history-dice">
              [{entry.diceValues.join(', ')}]
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
