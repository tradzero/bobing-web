import { useGameStore } from './GameStoreContext'

/** 当前轮次显示 */
export function RoundDisplay() {
  const round = useGameStore((s) => s.round)

  return <div className="round-display">第 {round} 轮</div>
}
