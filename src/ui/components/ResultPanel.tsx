import { useGameStore } from './GameStoreContext'
import { Prize } from '@/rules/types'
import { PRIZE_NAMES } from '@/rules/judge'

/** 结果面板：显示当轮点数、奖级、带数 */
export function ResultPanel() {
  const phase = useGameStore((s) => s.phase)
  const diceValues = useGameStore((s) => s.diceValues)
  const currentResult = useGameStore((s) => s.currentResult)

  if (phase !== 'result' || !currentResult) return null

  const isNone = currentResult.prize === Prize.None

  return (
    <div className="result-panel">
      <div className={`result-prize ${isNone ? 'no-prize' : ''}`}>
        {PRIZE_NAMES[currentResult.prize]}
      </div>
      {currentResult.carryScore > 0 && (
        <div className="result-carry">带{currentResult.carryScore}</div>
      )}
      <div className="result-dice">
        {diceValues.map((v, i) => (
          <span key={i} className={`dice-pip ${v === 4 ? 'red' : ''}`}>
            {v}
          </span>
        ))}
      </div>
    </div>
  )
}
