import { createContext, useContext } from 'react'
import { GameController } from '@/game/controller'

export const GameControllerContext = createContext<GameController | null>(null)

export function useGameController(): GameController {
  const controller = useContext(GameControllerContext)
  if (!controller) {
    throw new Error('useGameController must be used within GameControllerContext.Provider')
  }
  return controller
}
