// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { runRoll } from '@dice/physics-core'
import { WALL_RADIUS } from '@dice/physics-core/physics/bowl-body'

/**
 * 逃逸验收使用真实 throwDice 与统一物理 runner，并检查完整轨迹而非宽松外部范围。
 */
describe('骰子逃逸防护', () => {
  const seeds = [
    42, 1, 7777, 12345, 99999, 314159, 65535, 123456789, 271828, 5555, 666, 11111, 54321, 777777,
    1000000, 8675309, 31337, 13, 9999999, 2024,
  ]

  for (const seed of seeds) {
    it(`种子 ${seed}: 完整轨迹未越过物理挡墙`, () => {
      const result = runRoll({ seed })
      const reproduce = `pnpm test:seed -- --seed=${seed}`

      expect(result.wallCenterCrossings, reproduce).toBe(0)
      expect(result.maxRadius, reproduce).toBeLessThan(WALL_RADIUS)
      expect(result.finalRadius, reproduce).toBeLessThan(WALL_RADIUS)
      expect(result.escapeGuardInterventionCount, reproduce).toBe(0)
      expect(result.settleReason, reproduce).not.toBe('timeout')
      expect(result.settleReason, reproduce).not.toBe('frame-budget-exhausted')
    })
  }
})
