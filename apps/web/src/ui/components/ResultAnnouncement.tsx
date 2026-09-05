import { PRIZE_NAMES, Prize, type JudgeResult } from '@dice/game-domain'
import { DiceFace } from './DiceFace'

interface ResultAnnouncementProps {
  playerName: string
  result: JudgeResult
  diceValues: number[]
  note?: string
}

/** 只展示已提交结果；多人文案和点数由房间权威记录提供。 */
export function ResultAnnouncement({
  playerName,
  result,
  diceValues,
  note,
}: ResultAnnouncementProps) {
  const isNone = result.prize === Prize.None
  return (
    <div
      className={`result-panel result-announcement ${isNone ? 'result-panel-none' : 'result-panel-win'}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="result-announcement-heading">
        <span className="result-announcement-rule" aria-hidden="true" />
        <span>{isNone ? '六骰落定' : '喜 报'}</span>
        <span className="result-announcement-rule" aria-hidden="true" />
      </div>
      <div className="result-announcement-player">
        <strong>{playerName}</strong>
        <span>{isNone ? '本轮' : '博得'}</span>
      </div>
      <div className="result-announcement-outcome">
        <strong className={`result-prize ${isNone ? 'no-prize' : ''}`}>
          {PRIZE_NAMES[result.prize]}
        </strong>
        {result.carryScore > 0 && <span className="result-carry">带{result.carryScore}</span>}
      </div>
      <div className="result-dice">
        {diceValues.map((value, index) => (
          <DiceFace key={index} value={value} mini />
        ))}
      </div>
      <div className="result-panel-footnote">
        {note ?? (isNone ? '好彩头留在下一掷' : '一掷好彩头，满桌共欢喜')}
      </div>
    </div>
  )
}
