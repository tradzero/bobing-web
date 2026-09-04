// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SETTLE } from '@/config/settle'
import { runRoll } from '@dice/physics-core'

/**
 * 旧套件曾在这里复制 world/throw/escape/settle 链路，并用已经过期的旧随机轨迹
 * 断言“8 秒内结算”。回归种子现在统一走正式 runner，测试只保留产品不变量。
 */
const SLOW_SEEDS = [1776308075747, 1776308125213, 1776308167330, 1776308186180, 1776308201964]

describe('历史慢结算种子回归', () => {
  it.each(SLOW_SEEDS)(
    'seed %s: 当前算法无异常终止且不依赖人工 Assist',
    { timeout: 30_000 },
    (seed) => {
      const result = runRoll({ seed })
      const reproduce = `pnpm test:seed -- --seed=${seed}`

      expect(result.nanDetected, reproduce).toBe(false)
      expect(result.wallCenterCrossings, reproduce).toBe(0)
      expect(result.escapeGuardInterventionCount, reproduce).toBe(0)
      expect(result.assistInterventionCount, reproduce).toBe(0)
      expect(result.settleReason, reproduce).not.toBe('cluster-assist')
      expect(result.settleReason, reproduce).not.toBe('timeout')
      expect(result.settleReason, reproduce).not.toBe('frame-budget-exhausted')
      expect(result.settleFrame, reproduce).toBeGreaterThan(0)
      expect(result.settleTime, reproduce).toBeLessThan(SETTLE.timeout)
      expect(result.finalFaces, reproduce).toHaveLength(6)
    },
  )
})

describe('历史斜停种子回归', () => {
  it('1776308150130: 当前算法产出六颗合法点数且无不可信姿态', () => {
    const seed = 1776308150130
    const result = runRoll({ seed })
    const reproduce = `pnpm test:seed -- --seed=${seed}`

    expect(result.settleReason, reproduce).not.toBe('timeout')
    expect(result.ambiguousDiceCount, reproduce).toBe(0)
    expect(
      result.finalFaces.map(({ value }) => value).every((value) => value >= 1 && value <= 6),
    ).toBe(true)
  })
})
