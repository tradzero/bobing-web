import { useEffect, useRef } from 'react'
import { useGameController } from '@/ui/components/GameControllerContext'
import { useGameStore } from '@/ui/components/GameStoreContext'
import type { MultiplayerRoomState } from './use-room'

export function RollSeedBridge({ activeRoll }: Pick<MultiplayerRoomState, 'activeRoll'>) {
  const controller = useGameController()
  const phase = useGameStore((state) => state.phase)
  const lastRollId = useRef<string | null>(null)
  useEffect(() => {
    if (!activeRoll || lastRollId.current === activeRoll.id) return
    if (controller.throwAuthoritative(activeRoll.seed)) lastRollId.current = activeRoll.id
  }, [activeRoll, controller, phase])
  return null
}
