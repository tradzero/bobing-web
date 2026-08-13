// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { runRoll } from '@/physics/roll-runner'
import { WALL_RADIUS } from '@/physics/bowl-body'
import { SETTLE } from '@/config/settle'
import { PHYSICS } from '@/config/physics'
import { judge } from '@/rules/judge'

/**
 * 每次提交使用的固定回归种子。
 * 包含常规样本与历史问题 seed；扩大样本由 scripts/physics-acceptance.ts 执行。
 */
const WATCH_SEEDS = [
  1, 13, 42, 5555, 7777, 12345, 65000, 65535, 67000, 72000, 99999, 208000, 212000, 314159, 1673000,
  2718281, 1776219009201, 1776310976115, 1776311021115,
]

describe('真实物理验收', () => {
  it.each(WATCH_SEEDS)('seed %s: 无 NaN、无越墙、无 timeout', { timeout: 30_000 }, (seed) => {
    const result = runRoll({ seed })
    const reproduce = `pnpm test:seed -- --seed=${seed}`

    expect(result.nanDetected, reproduce).toBe(false)
    expect(result.wallCenterCrossings, reproduce).toBe(0)
    expect(result.maxRadius, reproduce).toBeLessThan(WALL_RADIUS)
    expect(result.escapeGuardInterventionCount, reproduce).toBe(0)
    expect(result.assistInterventionCount, reproduce).toBe(0)
    expect(result.settleReason, reproduce).not.toBe('cluster-assist')
    expect(result.settleReason, reproduce).not.toBe('timeout')
    expect(result.settleReason, reproduce).not.toBe('frame-budget-exhausted')
    expect(result.settleFrame, reproduce).toBeGreaterThan(0)
    expect(result.settleTime, reproduce).toBeLessThan(SETTLE.timeout)
    expect(result.finalFaces).toHaveLength(6)
  })

  it('默认路径不使用人工 Assist，历史 variant 仍可显式复现', () => {
    const results = WATCH_SEEDS.map((seed) => runRoll({ seed }))
    const historicalVariant = runRoll({
      seed: 65_000,
      throwPlacementAlgorithm: 'legacy-v1',
      contactClusterAssistEnabled: true,
    })

    expect(results.every(({ assistInterventionCount }) => assistInterventionCount === 0)).toBe(true)
    expect(results.every(({ settleReason }) => settleReason !== 'cluster-assist')).toBe(true)
    expect(historicalVariant.settleReason).toBe('cluster-assist')
    expect(historicalVariant.assistInterventionCount).toBeGreaterThan(0)
  })

  it('seed 1673000: pose-stable-window 与 20s 自然延续的真值一致', { timeout: 30_000 }, () => {
    const seed = 1_673_000
    const reproduce = 'pnpm test:seed -- --seed=1673000'
    const runtime = runRoll({ seed })
    const continuation = runRoll({
      seed,
      settlementPolicy: 'natural-continuation',
      maxFrames: Math.ceil(20 / PHYSICS.fixedTimeStep),
    })

    expect(runtime.settleReason, reproduce).toBe('pose-stable-window')
    expect(runtime.assistInterventionCount, reproduce).toBe(0)
    expect(runtime.nanDetected, reproduce).toBe(false)
    expect(runtime.wallCenterCrossings, reproduce).toBe(0)
    expect(runtime.maxRadius, reproduce).toBeLessThan(WALL_RADIUS)
    expect(runtime.escapeGuardInterventionCount, reproduce).toBe(0)
    expect(runtime.settleTime, reproduce).toBeLessThan(SETTLE.timeout)

    expect(['natural-sleep', 'continuation-budget-exhausted']).toContain(continuation.settleReason)
    expect(continuation.nanDetected, reproduce).toBe(false)
    expect(continuation.wallCenterCrossings, reproduce).toBe(0)
    expect(continuation.maxRadius, reproduce).toBeLessThan(WALL_RADIUS)
    expect(continuation.escapeGuardInterventionCount, reproduce).toBe(0)
    expect(continuation.assistInterventionCount, reproduce).toBe(0)

    const runtimeValues = runtime.finalFaces.map(({ value }) => value)
    const continuationValues = continuation.finalFaces.map(({ value }) => value)
    const runtimeTiltClasses = runtime.finalFaces.map(
      ({ confidence }) => confidence < SETTLE.tiltThreshold,
    )
    const continuationTiltClasses = continuation.finalFaces.map(
      ({ confidence }) => confidence < SETTLE.tiltThreshold,
    )

    expect(continuationValues, reproduce).toEqual(runtimeValues)
    expect(continuationTiltClasses, reproduce).toEqual(runtimeTiltClasses)
    expect(judge(continuationValues), reproduce).toEqual(judge(runtimeValues))
  })
})
