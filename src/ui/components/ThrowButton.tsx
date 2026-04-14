import { useGameStore } from './GameStoreContext'
import { useGameController } from './GameControllerContext'

/** 掷骰按钮：rolling 阶段禁用并显示"骰子翻滚中" */
export function ThrowButton() {
  const phase = useGameStore((s) => s.phase)
  const ctrl = useGameController()
  const isRolling = phase === 'rolling'

  return (
    <button
      className="btn btn-throw"
      disabled={isRolling}
      onClick={() => ctrl.throw()}
    >
      {isRolling ? '骰子翻滚中' : '掷骰'}
    </button>
  )
}
