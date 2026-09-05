import { useGameStore } from './GameStoreContext'
import { ResultAnnouncement } from './ResultAnnouncement'

/** 结果面板：显示当轮点数、奖级、带数 */
export function ResultPanel() {
  const phase = useGameStore((s) => s.phase)
  const diceValues = useGameStore((s) => s.diceValues)
  const currentResult = useGameStore((s) => s.currentResult)

  // result 态显示正式结果；tilt-confirm 态不显示（由 TiltWarning 接管）
  if (phase !== 'result' || !currentResult) return null

  return <ResultAnnouncement playerName="你" result={currentResult} diceValues={diceValues} />
}
