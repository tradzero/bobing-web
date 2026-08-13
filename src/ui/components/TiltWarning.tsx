import { useGameStore } from './GameStoreContext'
import { useGameController } from './GameControllerContext'

/** 倾斜确认面板：提示哪些骰子倾斜，提供"接受结果"/"重掷"操作 */
export function TiltWarning() {
  const phase = useGameStore((s) => s.phase)
  const pending = useGameStore((s) => s.pendingSettlement)
  const ctrl = useGameController()

  if (phase !== 'tilt-confirm' || !pending) return null

  const tiltLabels = pending.tiltedIndices.map((i) => `第${i + 1}颗`).join('、')

  return (
    <div className="tilt-warning">
      <div className="tilt-warning-kicker">结果确认</div>
      <div className="tilt-warning-icon">⚠</div>
      <div className="tilt-warning-text">{tiltLabels}骰子倾斜，结果可能不准确</div>
      <div className="tilt-warning-actions">
        <button className="btn btn-accept" onClick={() => ctrl.acceptTilted()}>
          接受结果
        </button>
        <button className="btn btn-rethrow" onClick={() => ctrl.rethrow()}>
          重掷
        </button>
      </div>
    </div>
  )
}
