import { useGameStore } from './GameStoreContext'
import { useGameController } from './GameControllerContext'

/** 掷骰按钮：rolling / tilt-confirm 阶段禁用 */
export function ThrowButton() {
  const phase = useGameStore((s) => s.phase)
  const ctrl = useGameController()
  const isRolling = phase === 'rolling'
  const isBusy = phase === 'rolling' || phase === 'tilt-confirm'

  return (
    <button
      className={`btn btn-throw ${isRolling ? 'is-rolling' : ''}`}
      disabled={isBusy}
      onClick={() => ctrl.throw()}
    >
      <span className="btn-throw-ornament" aria-hidden="true" />
      <span className="btn-throw-label">{isRolling ? '骰子翻滚中' : '掷骰'}</span>
      <span className="btn-throw-ornament" aria-hidden="true" />
    </button>
  )
}
