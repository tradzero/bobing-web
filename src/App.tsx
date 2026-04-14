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

function App() {
  return (
    <GameViewport>
      <div className="game-overlay">
        {/* 顶部栏 */}
        <div className="top-bar">
          <RoundDisplay />
          <div className="top-actions">
            <SoundToggle />
            <ResetButton />
          </div>
        </div>

        {/* 右侧面板 */}
        <div className="side-panel">
          <PrizeRecord />
          <History />
        </div>

        {/* 底部操作区 */}
        <div className="bottom-area">
          <TiltWarning />
          <ResultPanel />
          <ThrowButton />
        </div>
      </div>
    </GameViewport>
  )
}

export default App
