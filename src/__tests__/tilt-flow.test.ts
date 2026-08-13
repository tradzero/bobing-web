// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GameController } from '@/game/controller'
import { createGameStore } from '@/game/store'
import type { Engine } from '@/game/engine'
import type { DicePair } from '@/dice/create'
import * as CANNON from 'cannon-es'
import { SETTLE } from '@/config/settle'

/**
 * 倾斜确认流程测试
 * 验证 tilt-confirm 态的完整生命周期：
 *   onSettled 分流 → pending 隔离 → acceptTilted / rethrow / reset 行为
 */

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

/**
 * 创建 dice pairs，可选让部分骰子倾斜
 * @param tiltIndices 需要倾斜的骰子索引，将绕 x 轴旋转 44°
 *   此时 max dot = cos(44°) ≈ 0.719 < 0.75 阈值，触发 tilt-confirm
 * @param tiltDeg 自定义倾斜角度（度），默认 44
 */
function mockDicePairs(tiltIndices: number[] = [], tiltDeg = 44): DicePair[] {
  return Array.from({ length: 6 }, (_, i) => {
    const body = new CANNON.Body({ mass: 1 })
    if (tiltIndices.includes(i)) {
      const q = new CANNON.Quaternion()
      q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), (tiltDeg * Math.PI) / 180)
      body.quaternion.copy(q)
    } else {
      // 默认四元数 → +y 朝上 → value=1, confidence≈1.0
      body.quaternion.set(0, 0, 0, 1)
    }
    return { mesh: {} as DicePair['mesh'], body }
  })
}

describe('倾斜确认流程', () => {
  let store: ReturnType<typeof createGameStore>
  let engine: Engine

  beforeEach(() => {
    store = createGameStore()
    engine = mockEngine()
  })

  /**
   * 辅助函数：跳过 throwDice（会随机化四元数），
   * 直接设 phase=rolling 并调用 onSettled，保留 mockDicePairs 设定的倾斜姿态
   */
  function settleWithoutThrow(ctrl: GameController) {
    store.getState().setPhase('rolling')
    ctrl.onSettled()
  }

  // ── 进入 tilt-confirm ──

  it('有倾斜骰子时 onSettled 进入 tilt-confirm', () => {
    const dicePairs = mockDicePairs([1, 4]) // 第2、5颗倾斜
    const ctrl = new GameController({ store, dicePairs })
    ctrl.setEngine(engine)

    settleWithoutThrow(ctrl)

    const state = store.getState()
    expect(state.phase).toBe('tilt-confirm')
    expect(state.pendingSettlement).not.toBeNull()
    expect(state.pendingSettlement!.tiltedIndices).toEqual([1, 4])
  })

  it('无倾斜骰子时 onSettled 直接进入 result', () => {
    const dicePairs = mockDicePairs([]) // 全部正常
    const ctrl = new GameController({ store, dicePairs })
    ctrl.setEngine(engine)

    settleWithoutThrow(ctrl)

    expect(store.getState().phase).toBe('result')
    expect(store.getState().pendingSettlement).toBeNull()
  })

  it('35° 靠壁姿态不进入 tilt-confirm（cos35° ≈ 0.819 > 0.75）', () => {
    // 碗壁正常倾斜 35° 不应触发倾斜确认
    const dicePairs = mockDicePairs([0, 2, 5], 35)
    const ctrl = new GameController({ store, dicePairs })
    ctrl.setEngine(engine)

    settleWithoutThrow(ctrl)

    expect(store.getState().phase).toBe('result')
    expect(store.getState().pendingSettlement).toBeNull()
  })

  // ── pending 隔离：round / history / prizeRecord 不被提前污染 ──

  it('tilt-confirm 时 round 不变', () => {
    const dicePairs = mockDicePairs([0])
    const ctrl = new GameController({ store, dicePairs })
    ctrl.setEngine(engine)

    const roundBefore = store.getState().round
    settleWithoutThrow(ctrl)

    expect(store.getState().phase).toBe('tilt-confirm')
    expect(store.getState().round).toBe(roundBefore)
  })

  it('tilt-confirm 时 history 不变', () => {
    const dicePairs = mockDicePairs([0])
    const ctrl = new GameController({ store, dicePairs })
    ctrl.setEngine(engine)

    settleWithoutThrow(ctrl)

    expect(store.getState().history).toEqual([])
  })

  it('tilt-confirm 时 prizeRecord 全为 0', () => {
    const dicePairs = mockDicePairs([0])
    const ctrl = new GameController({ store, dicePairs })
    ctrl.setEngine(engine)

    settleWithoutThrow(ctrl)

    const record = store.getState().prizeRecord
    expect(Object.values(record).every((v) => v === 0)).toBe(true)
  })

  // ── acceptTilted：确认后提交 ──

  it('acceptTilted 后 phase = result 且 round 前进', () => {
    const dicePairs = mockDicePairs([2])
    const ctrl = new GameController({ store, dicePairs })
    ctrl.setEngine(engine)

    const roundBefore = store.getState().round
    settleWithoutThrow(ctrl)
    expect(store.getState().phase).toBe('tilt-confirm')

    // 记下 pending 数据以验证提交内容
    const pending = store.getState().pendingSettlement!
    const expectedValues = [...pending.diceValues]
    const expectedResult = { ...pending.result }

    ctrl.acceptTilted()

    const state = store.getState()
    expect(state.phase).toBe('result')
    expect(state.round).toBe(roundBefore + 1)
    expect(state.pendingSettlement).toBeNull()
    // 验证提交内容与 pending 数据一致
    expect(state.diceValues).toEqual(expectedValues)
    expect(state.currentResult).toEqual(expectedResult)
    expect(state.history.length).toBe(1)
    expect(state.history[0].diceValues).toEqual(expectedValues)
    expect(state.history[0].result).toEqual(expectedResult)
    expect(state.history[0].round).toBe(roundBefore)
    // prizeRecord 中对应奖级 +1
    expect(state.prizeRecord[expectedResult.prize]).toBe(1)
  })

  it('acceptTilted 在非 tilt-confirm 态无效', () => {
    const dicePairs = mockDicePairs([])
    const ctrl = new GameController({ store, dicePairs })
    ctrl.setEngine(engine)

    ctrl.acceptTilted() // idle 态调用
    expect(store.getState().phase).toBe('idle')
  })

  // ── rethrow：重掷 ──

  it('rethrow 后 pending 清空、phase = rolling、round 不前进', () => {
    const dicePairs = mockDicePairs([3])
    const ctrl = new GameController({ store, dicePairs })
    ctrl.setEngine(engine)

    const roundBefore = store.getState().round
    settleWithoutThrow(ctrl)
    expect(store.getState().phase).toBe('tilt-confirm')

    ctrl.rethrow()

    const state = store.getState()
    expect(state.phase).toBe('rolling')
    expect(state.pendingSettlement).toBeNull()
    expect(state.round).toBe(roundBefore)
    expect(state.history).toEqual([])
    // rethrow 内部调用 beginSettle
    expect(engine.beginSettle).toHaveBeenCalledTimes(1)
  })

  it('rethrow 在非 tilt-confirm 态无效', () => {
    const dicePairs = mockDicePairs([])
    const ctrl = new GameController({ store, dicePairs })
    ctrl.setEngine(engine)

    ctrl.rethrow()
    expect(store.getState().phase).toBe('idle')
  })

  // ── throw 拒绝 tilt-confirm ──

  it('throw 在 tilt-confirm 态被拒绝', () => {
    const dicePairs = mockDicePairs([0])
    const ctrl = new GameController({ store, dicePairs })
    ctrl.setEngine(engine)

    settleWithoutThrow(ctrl)
    expect(store.getState().phase).toBe('tilt-confirm')

    ctrl.throw() // 应被拒绝
    expect(store.getState().phase).toBe('tilt-confirm')
    expect(engine.beginSettle).toHaveBeenCalledTimes(0)
  })

  // ── reset 在 tilt-confirm 态 ──

  it('reset 在 tilt-confirm 态允许，清空 pending', () => {
    const dicePairs = mockDicePairs([0])
    const ctrl = new GameController({ store, dicePairs })
    ctrl.setEngine(engine)

    settleWithoutThrow(ctrl)
    expect(store.getState().phase).toBe('tilt-confirm')

    ctrl.reset()

    const state = store.getState()
    expect(state.phase).toBe('idle')
    expect(state.pendingSettlement).toBeNull()
    expect(state.round).toBe(1)
    expect(state.history).toEqual([])
  })

  // ── 骰子冻结先于确认态 ──

  it('onSettled 进入 tilt-confirm 时骰子已冻结', () => {
    const dicePairs = mockDicePairs([0])
    const ctrl = new GameController({ store, dicePairs })
    ctrl.setEngine(engine)

    // 给骰子设置残余速度
    for (const { body } of dicePairs) {
      body.velocity.set(1, 2, 3)
      body.angularVelocity.set(4, 5, 6)
      body.wakeUp()
    }

    settleWithoutThrow(ctrl)

    expect(store.getState().phase).toBe('tilt-confirm')
    for (const { body } of dicePairs) {
      expect(body.velocity.length()).toBe(0)
      expect(body.angularVelocity.length()).toBe(0)
      expect(body.sleepState).toBe(CANNON.Body.SLEEPING)
    }
  })

  // ── 阈值边界 ──

  it('tiltThreshold 配置值为 0.75', () => {
    expect(SETTLE.tiltThreshold).toBe(0.75)
  })
})
