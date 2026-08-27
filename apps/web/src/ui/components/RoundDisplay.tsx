import { useGameStore } from './GameStoreContext'

/** 当前轮次显示 */
export function RoundDisplay() {
  const round = useGameStore((s) => s.round)

  return (
    <div className="round-display">
      <div className="round-display-kicker">当前轮次</div>
      <div className="round-display-value">第 {round} 轮</div>
    </div>
  )
}
