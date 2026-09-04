// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createDiceBody } from '@dice/physics-core/dice/dice-body'
import type { DicePair } from '@/dice/create'
import { throwDice } from '@dice/physics-core/dice/throw'
import { THROW } from '@dice/physics-core/config/throw'
import { runRoll } from '@dice/physics-core'
import { WALL_RADIUS } from '@dice/physics-core/physics/bowl-body'
import { reseed, resetRandom } from '@dice/physics-core/random'

/**
 * 物理烟雾测试只驱动统一 runner，避免测试复制一份近似的运行时循环。
 */
describe('物理烟雾测试', () => {
  afterEach(resetRandom)

  const seeds = [42, 12345, 7777, 99999, 314159, 1, 65535, 123456789, 2718281, 5555]

  for (const seed of seeds) {
    it(`种子 ${seed}: 无 NaN、不越墙、不超时`, () => {
      const result = runRoll({ seed })
      const reproduce = `pnpm test:seed -- --seed=${seed}`

      expect(result.nanDetected, reproduce).toBe(false)
      expect(result.wallCenterCrossings, reproduce).toBe(0)
      expect(result.maxRadius, reproduce).toBeLessThan(WALL_RADIUS)
      expect(result.settleReason, reproduce).not.toBe('timeout')
      expect(result.settleReason, reproduce).not.toBe('frame-budget-exhausted')
      expect(result.settleFrame, reproduce).toBeGreaterThan(0)
    })
  }

  /** seed 1776219009201 曾因初始位置重叠产生 NaN。 */
  it('seed 1776219009201: 初始位置无重叠且完整模拟无 NaN', () => {
    const seed = 1776219009201
    reseed(seed)
    const dicePairs: DicePair[] = Array.from({ length: 6 }, () => ({
      mesh: {} as DicePair['mesh'],
      body: createDiceBody(),
    }))
    throwDice(dicePairs)

    for (let i = 0; i < dicePairs.length; i++) {
      for (let j = i + 1; j < dicePairs.length; j++) {
        const positionA = dicePairs[i].body.position
        const positionB = dicePairs[j].body.position
        const distance = Math.hypot(positionA.x - positionB.x, positionA.z - positionB.z)
        expect(distance, `骰子${i + 1}与${j + 1}发生初始重叠`).toBeGreaterThanOrEqual(
          THROW.minSeparation - 0.001,
        )
      }
    }

    expect(runRoll({ seed }).nanDetected).toBe(false)
  })
})
