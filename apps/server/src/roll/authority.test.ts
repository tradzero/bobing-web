// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { judge } from '@dice/game-domain'
import { RollAuthority } from './authority'

describe('服务端权威投掷', () => {
  it('使用现有 headless 真实物理生成六骰结果和可调整展示延迟', () => {
    const authority = new RollAuthority({ revealMinMs: 1_200, revealMaxMs: 10_000 })
    const outcome = authority.compute(50_000)
    expect(outcome.kind).toBe('committable')
    expect(outcome.diceValues).toHaveLength(6)
    expect(() => judge(outcome.diceValues)).not.toThrow()
    expect(outcome.revealDelayMs).toBeGreaterThanOrEqual(1_200)
    expect(outcome.revealDelayMs).toBeLessThanOrEqual(10_000)
    expect(outcome.diagnostics).toMatchObject({ seed: 50_000, nanDetected: false })
  })

  it('展示延迟上下界不改变物理结果', () => {
    const fast = new RollAuthority({ revealMinMs: 0, revealMaxMs: 1_000 }).compute(50_000)
    const normal = new RollAuthority({ revealMinMs: 5_000, revealMaxMs: 6_000 }).compute(50_000)
    expect(fast.diceValues).toEqual(normal.diceValues)
    expect(fast.diagnostics.finalState).toEqual(normal.diagnostics.finalState)
    expect(fast.revealDelayMs).toBe(1_000)
    expect(normal.revealDelayMs).toBeGreaterThanOrEqual(5_000)
  })
})
