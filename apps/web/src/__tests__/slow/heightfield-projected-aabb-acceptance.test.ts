// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { runRoll } from '@dice/physics-core'

describe('HeightfieldProjectedAabbNarrowphase 慢速验收', () => {
  it(
    '200 seeds 的完整 RollRunResult 与 canonical 终态严格等价（含 watch 25042）',
    { timeout: 120_000 },
    () => {
      const seeds = [25_042, ...Array.from({ length: 199 }, (_, index) => 50_000 + index * 1_003)]
      for (const seed of seeds) {
        const baseline = runRoll({ seed, heightfieldNarrowphaseMode: 'cannon-default' })
        const candidate = runRoll({ seed, heightfieldNarrowphaseMode: 'projected-aabb-v1' })
        expect(candidate, `seed ${seed}`).toStrictEqual(baseline)
        expect(candidate.finalState, `seed ${seed} canonical final state`).toStrictEqual(
          baseline.finalState,
        )
      }
    },
  )
})
