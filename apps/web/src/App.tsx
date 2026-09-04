import '@/ui/styles/global.css'
import '@/ui/styles/game.css'
import { GameViewport } from '@/ui/components/GameViewport'
import { ThrowButton } from '@/ui/components/ThrowButton'
import { ResultPanel } from '@/ui/components/ResultPanel'
import { PrizeRecord } from '@/ui/components/PrizeRecord'
import { History } from '@/ui/components/History'
import { SoundToggle } from '@/ui/components/SoundToggle'
import { ResetButton } from '@/ui/components/ResetButton'
import { RoundDisplay } from '@/ui/components/RoundDisplay'
import { TiltWarning } from '@/ui/components/TiltWarning'
import { RollErrorPanel } from '@/ui/components/RollErrorPanel'
import { useGameStore } from '@/ui/components/GameStoreContext'
import { Prize } from '@dice/game-domain'
import { MultiplayerApp } from '@/multiplayer/MultiplayerApp'

const DISPLAY_PRIZES = Object.values(Prize).filter((prize) => prize !== Prize.None)

export function GameOverlay() {
  const phase = useGameStore((s) => s.phase)
  const history = useGameStore((s) => s.history)
  const prizeRecord = useGameStore((s) => s.prizeRecord)

  const hasSettlement = phase === 'result' || phase === 'tilt-confirm' || phase === 'error'
  const hasPrizeRecord = DISPLAY_PRIZES.some((prize) => (prizeRecord[prize] ?? 0) > 0)
  const hasPanelContent = hasPrizeRecord || history.length > 0
  const showContentPeek = !hasSettlement && !hasPanelContent

  return (
    <div className={`game-overlay phase-${phase}`}>
      {/* 顶部栏 */}
      <div className="top-bar">
        <div className="top-bar-start">
          <div className="top-bar-brand">中秋博饼</div>
          <RoundDisplay />
        </div>
        <div className="top-actions">
          <SoundToggle />
          <ResetButton />
        </div>
      </div>

      <div className="mobile-dock">
        {/* 底部操作区 */}
        <div className="bottom-area">
          <div className="settlement-slot">
            <TiltWarning />
            <RollErrorPanel />
            <ResultPanel />
          </div>
          <ThrowButton />
          {showContentPeek && (
            <div className="content-peek" role="note">
              <span className="content-peek-label">记录区将在此展开</span>
            </div>
          )}
        </div>

        {/* 右侧面板 */}
        {hasPanelContent && (
          <div className="side-panel">
            <PrizeRecord />
            <History />
          </div>
        )}
      </div>
    </div>
  )
}

function App() {
  const multiplayerEnabled =
    import.meta.env.MODE !== 'test' &&
    import.meta.env.MODE !== 'e2e' &&
    import.meta.env.VITE_MULTIPLAYER_ENABLED !== 'false'
  if (multiplayerEnabled) return <MultiplayerApp />
  return (
    <GameViewport>
      <GameOverlay />
    </GameViewport>
  )
}

export default App
