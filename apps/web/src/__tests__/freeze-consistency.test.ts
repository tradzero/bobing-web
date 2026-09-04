// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SETTLE } from '@/config/settle'
import { runRoll } from '@dice/physics-core'
import { judge } from '@dice/game-domain'

/**
 * 对历史上确实触发 cluster-assist 的固定 seed 做反事实：默认路径必须继续到
 * natural sleep；显式历史 variant 仍可复现人工截断，便于后续 A/B。
 */
describe('接触簇冻结反事实一致性', () => {
  const regressions = [
    { seed: 65_000, values: [1, 5, 4, 1, 2, 6] },
    { seed: 67_000, values: [4, 3, 4, 4, 5, 5] },
    { seed: 208_000, values: [5, 4, 5, 6, 1, 2] },
    { seed: 212_000, values: [4, 3, 2, 3, 2, 3] },
  ] as const

  for (const { seed, values } of regressions) {
    it(`种子 ${seed}: 默认自然结算，显式 variant 可复现 Assist`, () => {
      const natural = runRoll({ seed, throwPlacementAlgorithm: 'legacy-v1' })
      const assisted = runRoll({
        seed,
        throwPlacementAlgorithm: 'legacy-v1',
        contactClusterAssistEnabled: true,
      })
      const reproduce = `pnpm test:seed -- --seed=${seed}`

      expect(natural.settleReason, reproduce).toBe('natural-sleep')
      expect(natural.assistInterventionCount, reproduce).toBe(0)
      expect(assisted.settleReason, reproduce).toBe('cluster-assist')
      expect(assisted.assistInterventionCount, reproduce).toBeGreaterThan(0)

      const assistedValues = assisted.finalFaces.map(({ value }) => value)
      const naturalValues = natural.finalFaces.map(({ value }) => value)
      expect(naturalValues, reproduce).toEqual(values)
      expect(assistedValues, reproduce).toEqual(naturalValues)
      expect(judge(assistedValues), reproduce).toEqual(judge(naturalValues))
    })
  }

  it('种子 208000: 默认路径按自然终态进入倾斜确认', () => {
    const natural = runRoll({ seed: 208_000, throwPlacementAlgorithm: 'legacy-v1' })
    const assisted = runRoll({
      seed: 208_000,
      throwPlacementAlgorithm: 'legacy-v1',
      contactClusterAssistEnabled: true,
    })
    const naturallyTilted = natural.finalFaces[1]
    const prematurelyAccepted = assisted.finalFaces[1]

    expect(natural.settleReason).toBe('natural-sleep')
    expect(natural.ambiguousDiceCount).toBe(1)
    expect(naturallyTilted.value).toBe(4)
    expect(naturallyTilted.confidence).toBeLessThan(SETTLE.tiltThreshold)

    // 历史 Assist 在相同骰面尚高于阈值时截断，证明两条路径的 UI 语义确有差异。
    expect(assisted.settleReason).toBe('cluster-assist')
    expect(assisted.ambiguousDiceCount).toBe(0)
    expect(prematurelyAccepted.value).toBe(4)
    expect(prematurelyAccepted.confidence).toBeGreaterThan(SETTLE.tiltThreshold)
  })
})
