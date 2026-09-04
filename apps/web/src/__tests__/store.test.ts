import { describe, expect, it } from 'vitest'
import { createGameStore } from '@/game/store'
import { judge, Prize } from '@dice/game-domain'

describe('GameStore 异常状态契约', () => {
  it('setRollError 只终止当前轮，不推进轮次或改写既有历史与奖级记录', () => {
    const store = createGameStore()
    const priorResult = judge([4, 4, 4, 1, 2, 3])
    store.getState().setResult({ diceValues: [4, 4, 4, 1, 2, 3], result: priorResult })
    store.getState().setPhase('rolling')

    const before = store.getState()
    store.getState().setRollError({ reason: 'timeout', elapsed: 10 })

    const state = store.getState()
    expect(state).toMatchObject({
      phase: 'error',
      round: before.round,
      diceValues: [],
      currentResult: null,
      pendingSettlement: null,
      rollError: { reason: 'timeout', elapsed: 10 },
    })
    expect(state.history).toEqual(before.history)
    expect(state.prizeRecord).toEqual(before.prizeRecord)
    expect(state.prizeRecord[Prize.SanHong]).toBe(1)
  })

  it('timing-overload 保留完整调度诊断，清除异常后仍在同一轮 rolling', () => {
    const store = createGameStore()
    store.getState().setPhase('rolling')

    store.getState().setRollError({
      reason: 'timing-overload',
      simulationElapsed: 1 / 3,
      queuedMs: 800 / 3,
      highWaterMs: 250,
      executedSteps: 20,
    })

    expect(store.getState()).toMatchObject({
      phase: 'error',
      round: 1,
      diceValues: [],
      currentResult: null,
      pendingSettlement: null,
      rollError: {
        reason: 'timing-overload',
        simulationElapsed: 1 / 3,
        queuedMs: 800 / 3,
        highWaterMs: 250,
        executedSteps: 20,
      },
    })

    store.getState().clearRollError()
    expect(store.getState()).toMatchObject({
      phase: 'rolling',
      round: 1,
      rollError: null,
    })
  })

  it('resetState 清空异常和游戏记录，但保留当前音效设置', () => {
    const store = createGameStore()
    store.getState().toggleSound()
    store.getState().setRollError({ reason: 'timeout', elapsed: 10 })

    store.getState().resetState()

    expect(store.getState()).toMatchObject({
      phase: 'idle',
      round: 1,
      history: [],
      diceValues: [],
      currentResult: null,
      pendingSettlement: null,
      rollError: null,
      soundEnabled: false,
    })
    expect(Object.values(store.getState().prizeRecord).every((count) => count === 0)).toBe(true)
  })
})
