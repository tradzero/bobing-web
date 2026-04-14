import { useGameStore } from './GameStoreContext'
import { useGameController } from './GameControllerContext'

/** 重置按钮：rolling 阶段禁用 */
export function ResetButton() {
  const phase = useGameStore((s) => s.phase)
  const ctrl = useGameController()

  return (
    <button
      className="btn btn-icon"
      disabled={phase === 'rolling'}
      onClick={() => ctrl.reset()}
      title="重置游戏"
    >
      ↺
    </button>
  )
}
