// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GameController } from '@/game/controller'
import { createGameStore } from '@/game/store'
import { UI } from '@/config/ui'
import type { Engine } from '@/game/engine'
import type { DicePair } from '@/dice/create'
import * as CANNON from 'cannon-es'
import { bowlInnerHeight } from '@/config/bowl'
import { PHYSICS } from '@/config/physics'
import { REST_RING_RADIUS } from '@/dice/rest'

/** 创建 mock engine */
function mockEngine(): Engine {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    beginSettle: vi.fn(),
    returnToIdle: vi.fn(),
    invalidate: vi.fn(),
    getDiagnostics: vi.fn(),
  }
}

/** 创建 mock dice pairs（body 带有已知四元数用于读面） */
function mockDicePairs(count = 6): DicePair[] {
  return Array.from({ length: count }, () => {
    const body = new CANNON.Body({ mass: 1 })
    // 默认四元数 (0,0,0,1) → +y 朝上 → 点数 1
    body.quaternion.set(0, 0, 0, 1)
    return { mesh: {} as DicePair['mesh'], body }
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
    controller = new GameController({ store, dicePairs })
    controller.setEngine(engine)
  })

  /** throwDice 随机化四元数，重置为正面朝上以避免触发倾斜确认 */
  function settleFlat() {
    for (const { body } of dicePairs) {
      body.quaternion.set(0, 0, 0, 1)
    }
    controller.onSettled()
  }

  it('phase 变化正确：idle → rolling → result', () => {
    expect(store.getState().phase).toBe('idle')

    controller.throw()
    expect(store.getState().phase).toBe('rolling')
    expect(engine.beginSettle).toHaveBeenCalled()

    settleFlat()
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
    settleFlat()
    expect(store.getState().phase).toBe('result')

    controller.throw()
    expect(store.getState().phase).toBe('rolling')
    expect(engine.beginSettle).toHaveBeenCalledTimes(2)
  })

  it(`结算后 history 只保留最近 ${UI.HISTORY_MAX_LENGTH} 轮`, () => {
    for (let i = 0; i < UI.HISTORY_MAX_LENGTH + 3; i++) {
      controller.throw()
      settleFlat()
    }
    expect(store.getState().history.length).toBe(UI.HISTORY_MAX_LENGTH)
  })

  it('reset 清理当轮 + 累计记录', () => {
    controller.throw()
    settleFlat()
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
    settleFlat()
    expect(store.getState().phase).toBe('result')
    expect(store.getState().soundEnabled).toBe(false)

    controller.toggleSound()
    expect(store.getState().soundEnabled).toBe(true)
  })

  it('onSettled 正确读取点数和判定奖级', () => {
    controller.throw()
    settleFlat()

    const state = store.getState()
    expect(state.diceValues.length).toBe(6)
    expect(state.currentResult).not.toBeNull()
    expect(state.currentResult!.prize).toBeDefined()
    expect(state.currentResult!.priority).toBeGreaterThanOrEqual(1)
  })

  it('一次性 nextSeed 和实际投掷/停稳路径可诊断', () => {
    controller = new GameController({ store, dicePairs, nextSeed: 42 })
    controller.setEngine(engine)

    controller.throw()
    expect(controller.getRollDiagnostics()).toMatchObject({
      seed: 42,
      throwAlgorithmVersion: 3,
      placementAlgorithm: 'stratified-ring',
      placementAttempts: expect.any(Number),
      placementRestarts: expect.any(Number),
      placementGroupAttempts: expect.any(Number),
      randomPlanVersion: 1,
      placementPath: 'constructive',
      settleAlgorithmVersion: 4,
      settleReason: null,
      settleElapsed: null,
    })

    for (const { body } of dicePairs) body.quaternion.set(0, 0, 0, 1)
    controller.onSettled({ reason: 'natural-sleep', elapsed: 2.1 })
    expect(controller.getRollDiagnostics()).toMatchObject({
      seed: 42,
      settleReason: 'natural-sleep',
      settleElapsed: 2.1,
    })

    const now = vi.spyOn(Date, 'now').mockReturnValue(123_456)
    controller.throw()
    expect(controller.getRollDiagnostics()).toMatchObject({
      seed: 123_456,
      settleReason: null,
      settleElapsed: null,
    })
    now.mockRestore()
  })

  // ── 物理副作用测试 ──

  it('onSettled 冻结骰子：速度/角速度清零 + sleep', () => {
    controller.throw()
    // 模拟骰子有残余运动
    for (const { body } of dicePairs) {
      body.velocity.set(1, 2, 3)
      body.angularVelocity.set(4, 5, 6)
      body.wakeUp()
    }

    settleFlat()

    for (const { body } of dicePairs) {
      expect(body.velocity.length(), '线速度应为 0').toBe(0)
      expect(body.angularVelocity.length(), '角速度应为 0').toBe(0)
      expect(body.sleepState, '应进入 sleep').toBe(CANNON.Body.SLEEPING)
    }
  })

  it('reset 恢复骰子物理状态', () => {
    controller.throw()
    settleFlat()

    // 乱设一些状态
    for (const { body } of dicePairs) {
      body.position.set(5, 5, 5)
      body.previousPosition.set(-1, -1, -1)
      body.quaternion.set(0.5, 0.5, 0.5, 0.5)
      body.aabbNeedsUpdate = false
    }

    controller.reset()

    for (const { body } of dicePairs) {
      // 位置恢复到碗底表面上方
      expect(body.position.y).toBeGreaterThan(
        bowlInnerHeight(REST_RING_RADIUS) + PHYSICS.diceHalfSize,
      )
      // previous/interpolated position 同步
      expect(body.previousPosition.x).toBe(body.position.x)
      expect(body.previousPosition.y).toBe(body.position.y)
      expect(body.previousPosition.z).toBe(body.position.z)
      expect(body.interpolatedPosition.x).toBe(body.position.x)
      expect(body.interpolatedPosition.y).toBe(body.position.y)
      expect(body.interpolatedPosition.z).toBe(body.position.z)
      // 四元数恢复为单位四元数
      expect(body.quaternion.w).toBe(1)
      expect(body.quaternion.x).toBe(0)
      // 速度清零
      expect(body.velocity.length()).toBe(0)
      expect(body.angularVelocity.length()).toBe(0)
      // AABB 标记更新
      expect(body.aabbNeedsUpdate).toBe(true)
      // idle 不推进物理，静态骰子应保持休眠
      expect(body.sleepState).toBe(CANNON.Body.SLEEPING)
    }
    expect(engine.returnToIdle).toHaveBeenCalledTimes(1)
  })
})
