import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { GameStore, createGameStore } from '@/game/store'

type StoreInstance = ReturnType<typeof createGameStore>

export const GameStoreContext = createContext<StoreInstance | null>(null)

/**
 * 从 Context 获取 store 实例，配合 selector 使用
 * 示例: const phase = useGameStore(s => s.phase)
 */
export function useGameStore<T>(selector: (state: GameStore) => T): T {
  const store = useContext(GameStoreContext)
  if (!store) {
    throw new Error('useGameStore must be used within GameStoreContext.Provider')
  }
  return useStore(store, selector)
}
