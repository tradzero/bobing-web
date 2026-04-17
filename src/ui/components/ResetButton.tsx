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
      aria-label="重置游戏"
    >
      <span className="btn-icon-ring" aria-hidden="true" />
      <span className="btn-icon-glyph btn-icon-glyph-reset" aria-hidden="true">
        <svg viewBox="0 0 24 24" role="presentation">
          <path d="M8.1 8.35H4.75V4.95" />
          <path d="M5.15 8.15C6.6 5.95 9.08 4.6 11.9 4.6C16.25 4.6 19.75 8.1 19.75 12.45C19.75 16.8 16.25 20.3 11.9 20.3C8.55 20.3 5.65 18.2 4.55 15.2" />
        </svg>
      </span>
    </button>
  )
}
