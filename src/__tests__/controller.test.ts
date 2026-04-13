// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GameController } from '@/game/controller'
import { createGameStore } from '@/game/store'
import { UI } from '@/config/ui'
import type { Engine } from '@/game/engine'
import type { DicePair } from '@/dice/create'
import * as CANNON from 'cannon-es'

/** 创建 mock engine */
function mockEngine(): Engine {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    beginSettle: vi.fn(),
  }
}

/** 创建 mock dice pairs（body 带有已知四元数用于读面） */
function mockDicePairs(count = 6): DicePair[] {
  return Array.from({ length: count }, () => {
    const body = new CANNON.Body({ mass: 1 })
    // 默认四元数 (0,0,0,1) → +y 朝上 → 点数 1
    body.quaternion.set(0, 0, 0, 1)
    return { mesh: {} as any, body }
  })
}

describe('GameController 编排层集成测试', () => {
  let store: ReturnType<typeof createGameStore>
  let engine: Engine
  let dicePairs: DicePair[]
  let controller: GameController

  beforeEach(() => {
    store = createGameStore()
    engine = mockEngine()
    dicePairs = mockDicePairs()
    controller = new GameController({ store, engine, dicePairs })
  })

  it('phase 变化正确：idle → rolling → result', () => {
    expect(store.getState().phase).toBe('idle')

    controller.throw()
    expect(store.getState().phase).toBe('rolling')
    expect(engine.beginSettle).toHaveBeenCalled()

    controller.onSettled()
    expect(store.getState().phase).toBe('result')
  })

  it('rolling 中二次点击 throw() 被拒绝', () => {
    controller.throw()
    expect(store.getState().phase).toBe('rolling')

    controller.throw() // 应被拒绝
    expect(engine.beginSettle).toHaveBeenCalledTimes(1) // 只调用了一次
  })

  it('result 阶段直接再次 throw() 能正常进入 rolling', () => {
    controller.throw()
    controller.onSettled()
    expect(store.getState().phase).toBe('result')

    controller.throw()
    expect(store.getState().phase).toBe('rolling')
    expect(engine.beginSettle).toHaveBeenCalledTimes(2)
  })

  it(`结算后 history 只保留最近 ${UI.HISTORY_MAX_LENGTH} 轮`, () => {
    for (let i = 0; i < UI.HISTORY_MAX_LENGTH + 3; i++) {
      controller.throw()
      controller.onSettled()
    }
    expect(store.getState().history.length).toBe(UI.HISTORY_MAX_LENGTH)
  })

  it('reset 清理当轮 + 累计记录', () => {
    controller.throw()
    controller.onSettled()
    expect(store.getState().currentResult).not.toBeNull()

    controller.reset()
    expect(store.getState().phase).toBe('idle')
    expect(store.getState().round).toBe(UI.INITIAL_ROUND)
    expect(store.getState().currentResult).toBeNull()
    expect(store.getState().history).toEqual([])
  })

  it('rolling 中调用 reset() 被拒绝', () => {
    controller.throw()
    expect(store.getState().phase).toBe('rolling')

    controller.reset()
    expect(store.getState().phase).toBe('rolling') // 不变
  })

  it('sound toggle 不影响主流程', () => {
    expect(store.getState().soundEnabled).toBe(true)
    controller.toggleSound()
    expect(store.getState().soundEnabled).toBe(false)

    // 正常走流程
    controller.throw()
    controller.onSettled()
    expect(store.getState().phase).toBe('result')
    expect(store.getState().soundEnabled).toBe(false)

    controller.toggleSound()
    expect(store.getState().soundEnabled).toBe(true)
  })

  it('onSettled 正确读取点数和判定奖级', () => {
    controller.throw()
    controller.onSettled()

    const state = store.getState()
    expect(state.diceValues.length).toBe(6)
    expect(state.currentResult).not.toBeNull()
    expect(state.currentResult!.prize).toBeDefined()
    expect(state.currentResult!.priority).toBeGreaterThanOrEqual(1)
  })
})
