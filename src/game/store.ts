import { createStore } from 'zustand/vanilla'
import { Prize, type JudgeResult } from '@/rules/types'
import { UI } from '@/config/ui'

/** 历史记录条目 */
export interface HistoryEntry {
  round: number
  diceValues: number[]
  result: JudgeResult
}

/** 待确认结算数据（倾斜确认流程） */
export interface PendingSettlement {
  diceValues: number[]
  result: JudgeResult
  /** 倾斜骰子的索引（0-based） */
  tiltedIndices: number[]
}

/** 当前轮无法可信结算时的显式异常；不得包含或提交骰面/奖级。 */
export interface RollError {
  reason: 'timeout'
  elapsed: number
}

/** 游戏状态 */
export interface GameState {
  phase: 'idle' | 'rolling' | 'tilt-confirm' | 'result' | 'error'
  round: number
  diceValues: number[]
  currentResult: JudgeResult | null
  history: HistoryEntry[]
  prizeRecord: Record<Prize, number>
  soundEnabled: boolean
  playerId: string | null
  /** 倾斜确认态下的待提交数据 */
  pendingSettlement: PendingSettlement | null
  /** error 态的可观测原因；正常流程必须为 null。 */
  rollError: RollError | null
}

/** Store actions（纯状态设置器） */
export interface GameActions {
  setPhase: (phase: GameState['phase']) => void
  setResult: (payload: { diceValues: number[]; result: JudgeResult }) => void
  /** 写入待确认结算数据，进入 tilt-confirm 态 */
  setPending: (payload: PendingSettlement) => void
  /** 确认待提交结果，提交到历史/奖级/轮次，进入 result 态 */
  commitPending: () => void
  /** 清空待提交数据，回到 rolling 态（重掷用） */
  clearPending: () => void
  /** 进入不可结算异常态；不提交任何业务结果。 */
  setRollError: (error: RollError) => void
  /** 清空异常并保持同一轮，随后由 controller 启动新投掷。 */
  clearRollError: () => void
  resetState: () => void
  toggleSound: () => void
}

export type GameStore = GameState & GameActions

/** 初始化奖级记录（全部归零） */
function initPrizeRecord(): Record<Prize, number> {
  const record: Record<string, number> = {}
  for (const key of Object.values(Prize)) {
    record[key] = 0
  }
  return record
}

/**
 * 共用结果提交逻辑（setResult 和 commitPending 都走这条路）
 * 将 diceValues + JudgeResult 写入 history、prizeRecord、round，设 phase='result'
 */
function applyResult(
  state: GameState,
  diceValues: number[],
  result: JudgeResult,
): Partial<GameStore> {
  const entry: HistoryEntry = {
    round: state.round,
    diceValues,
    result,
  }
  const history = [entry, ...state.history].slice(0, UI.HISTORY_MAX_LENGTH)
  const prizeRecord = { ...state.prizeRecord }
  prizeRecord[result.prize] = (prizeRecord[result.prize] ?? 0) + 1

  return {
    phase: 'result' as const,
    diceValues,
    currentResult: result,
    round: state.round + 1,
    history,
    prizeRecord,
    pendingSettlement: null,
    rollError: null,
  }
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
  pendingSettlement: null,
  rollError: null,
}

/**
 * 创建 vanilla Zustand store（不绑定 React）
 * 便于在 controller 中直接使用
 */
export function createGameStore() {
  return createStore<GameStore>((set) => ({
    ...initialState,

    setPhase: (phase) => set({ phase, ...(phase === 'rolling' ? { rollError: null } : {}) }),

    setResult: ({ diceValues, result }) => set((state) => applyResult(state, diceValues, result)),

    setPending: (payload) =>
      set({
        phase: 'tilt-confirm' as const,
        pendingSettlement: payload,
        // 暂存 diceValues 供 UI 预览（但不写入 history/prizeRecord）
        diceValues: payload.diceValues,
        currentResult: payload.result,
        rollError: null,
      }),

    commitPending: () =>
      set((state) => {
        const pending = state.pendingSettlement
        if (!pending) return {}
        return applyResult(state, pending.diceValues, pending.result)
      }),

    clearPending: () =>
      set({
        phase: 'rolling' as const,
        pendingSettlement: null,
        diceValues: [],
        currentResult: null,
        rollError: null,
      }),

    setRollError: (rollError) =>
      set({
        phase: 'error' as const,
        rollError,
        pendingSettlement: null,
        diceValues: [],
        currentResult: null,
      }),

    clearRollError: () =>
      set({
        phase: 'rolling' as const,
        rollError: null,
        pendingSettlement: null,
        diceValues: [],
        currentResult: null,
      }),

    resetState: () =>
      set((state) => ({
        ...initialState,
        soundEnabled: state.soundEnabled,
        prizeRecord: initPrizeRecord(),
      })),

    toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
  }))
}
