import { useGameStore } from './GameStoreContext'
import { useGameController } from './GameControllerContext'

/** 音效开关按钮 */
export function SoundToggle() {
  const soundEnabled = useGameStore((s) => s.soundEnabled)
  const ctrl = useGameController()

  return (
    <button
      className="btn btn-icon"
      onClick={() => ctrl.toggleSound()}
      title={soundEnabled ? '关闭音效' : '开启音效'}
    >
      <span className="btn-icon-ring" aria-hidden="true" />
      <span className="btn-icon-glyph">{soundEnabled ? '🔊' : '🔇'}</span>
    </button>
  )
}
