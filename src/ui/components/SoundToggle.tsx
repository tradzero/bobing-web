import { useGameStore } from './GameStoreContext'
import { useGameController } from './GameControllerContext'

/** 音效开关按钮 */
export function SoundToggle() {
  const soundEnabled = useGameStore((s) => s.soundEnabled)
  const ctrl = useGameController()
  const label = soundEnabled ? '关闭音效' : '开启音效'

  return (
    <button
      className="btn btn-icon"
      onClick={() => ctrl.toggleSound()}
      title={label}
      aria-label={label}
    >
      <span className="btn-icon-ring" aria-hidden="true" />
      <span className={`btn-icon-glyph btn-icon-glyph-sound ${soundEnabled ? 'is-on' : 'is-off'}`} aria-hidden="true">
        <svg viewBox="0 0 24 24" role="presentation">
          <path d="M5.5 14.5H8.6L13.4 18V6L8.6 9.5H5.5Z" />
          <path d="M16.3 9.3C17.45 10.2 18.1 11.48 18.1 12.85C18.1 14.22 17.45 15.5 16.3 16.4" />
          <path d="M18.75 6.95C20.45 8.35 21.4 10.5 21.4 12.85C21.4 15.2 20.45 17.35 18.75 18.75" />
          {!soundEnabled && <path d="M6 6L18 18" />}
        </svg>
      </span>
    </button>
  )
}
