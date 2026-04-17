import { useGameStore } from './GameStoreContext'
import { Prize } from '@/rules/types'
import { PRIZE_NAMES } from '@/rules/judge'
import { DiceFace } from './DiceFace'

/** 结果面板：显示当轮点数、奖级、带数 */
export function ResultPanel() {
  const phase = useGameStore((s) => s.phase)
  const diceValues = useGameStore((s) => s.diceValues)
  const currentResult = useGameStore((s) => s.currentResult)

  // result 态显示正式结果；tilt-confirm 态不显示（由 TiltWarning 接管）
  if (phase !== 'result' || !currentResult) return null

  const isNone = currentResult.prize === Prize.None

  return (
    <div className={`result-panel ${isNone ? 'result-panel-none' : 'result-panel-win'}`}>
      <div className="result-panel-decor result-panel-decor-left" aria-hidden="true">☁</div>
      <div className="result-panel-decor result-panel-decor-right" aria-hidden="true">☁</div>
      <div className="result-panel-rabbit" aria-hidden="true">兔</div>
      <div className="result-panel-lantern" aria-hidden="true" />
      <div className="result-kicker">本轮结算</div>
      <div className={`result-prize ${isNone ? 'no-prize' : ''}`}>
        {PRIZE_NAMES[currentResult.prize]}
      </div>
      {currentResult.prize === Prize.ZhuangYuan && currentResult.carryScore > 0 && (
        <div className="result-carry">带{currentResult.carryScore}</div>
      )}
      <div className="result-dice">
        {diceValues.map((v, i) => (
          <DiceFace key={i} value={v} />
        ))}
      </div>
      <div className="result-panel-footnote">六骰同观，奖级以最高优先级结算</div>
    </div>
  )
}
