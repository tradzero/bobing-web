import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { Prize, type JudgeResult } from '@/rules/types'
import { UI } from '@/config/ui'

/** 历史记录条目 */
export interface HistoryEntry {
  round: number
  diceValues: number[]
  result: JudgeResult
}

/** 游戏状态 */
export interface GameState {
  phase: 'idle' | 'rolling' | 'result'
  round: number
  diceValues: number[]
  currentResult: JudgeResult | null
  history: HistoryEntry[]
  prizeRecord: Record<string, number>
  soundEnabled: boolean
  playerId: string | null
}

/** Store actions（纯状态设置器） */
export interface GameActions {
  setPhase: (phase: GameState['phase']) => void
  setResult: (payload: { diceValues: number[]; result: JudgeResult }) => void
  resetState: () => void
  toggleSound: () => void
}

export type GameStore = GameState & GameActions

/** 初始化奖级记录（全部归零） */
function initPrizeRecord(): Record<string, number> {
  const record: Record<string, number> = {}
  for (const key of Object.values(Prize)) {
    record[key] = 0
  }
  return record
}

const initialState: GameState = {
  phase: 'idle',
  round: UI.INITIAL_ROUND,
  diceValues: [],
  currentResult: null,
  history: [],
  prizeRecord: initPrizeRecord(),
  soundEnabled: true,
  playerId: null,
}

/**
 * 创建 vanilla Zustand store（不绑定 React）
 * 便于在 controller 中直接使用
 */
export function createGameStore() {
  return createStore<GameStore>((set) => ({
    ...initialState,

    setPhase: (phase) => set({ phase }),

    setResult: ({ diceValues, result }) =>
      set((state) => {
        const entry: HistoryEntry = {
          round: state.round,
          diceValues,
          result,
        }
        const history = [entry, ...state.history].slice(
          0,
          UI.HISTORY_MAX_LENGTH,
        )
        const prizeRecord = { ...state.prizeRecord }
        prizeRecord[result.prize] = (prizeRecord[result.prize] ?? 0) + 1

        return {
          phase: 'result' as const,
          diceValues,
          currentResult: result,
          round: state.round + 1,
          history,
          prizeRecord,
        }
      }),

    resetState: () => set({ ...initialState, prizeRecord: initPrizeRecord() }),

    toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
  }))
}

/** React hook 绑定 */
export function createUseGameStore(store: ReturnType<typeof createGameStore>) {
  return <T>(selector: (state: GameStore) => T): T => useStore(store, selector)
}
