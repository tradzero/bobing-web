import { useEffect, useRef } from 'react'
import { useGameController } from '@/ui/components/GameControllerContext'
import { useGameStore } from '@/ui/components/GameStoreContext'
import type { MultiplayerRoomState } from './use-room'

export function RollSeedBridge({
  activeRoll,
  onPlaybackStarted,
}: Pick<MultiplayerRoomState, 'activeRoll'> & {
  onPlaybackStarted?: (rollId: string) => void
}) {
  const controller = useGameController()
  const phase = useGameStore((state) => state.phase)
  const lastRollId = useRef<string | null>(null)
  useEffect(() => {
    if (!activeRoll || lastRollId.current === activeRoll.id) return
    if (controller.throwAuthoritative(activeRoll.seed)) {
      lastRollId.current = activeRoll.id
      onPlaybackStarted?.(activeRoll.id)
    }
  }, [activeRoll, controller, phase, onPlaybackStarted])
  return null
}
