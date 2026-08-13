import { describe, expect, it } from 'vitest'
import {
  ROLLING_CPU_PROFILE_METRICS,
  createRollingCpuProfileAccumulator,
  type RollingCpuFrameSample,
} from '@/game/performance-profile'

function sample(value: number): RollingCpuFrameSample {
  return {
    rafRawDeltaMs: value,
    rafClampedDeltaMs: value,
    cannonStepnumberDelta: value,
    worldStepCpuMs: value,
    guardCpuMs: value,
    rollSafetyCpuMs: value,
    settleCpuMs: value,
    transformSyncCpuMs: value,
    rendererSubmitCpuMs: value,
    diagnosticsPublishCpuMs: value,
    tickTotalCpuMs: value,
  }
}

describe('rolling CPU profile accumulator', () => {
  it('固定容量只聚合最新的完整帧，同时保留总帧数', () => {
    const profile = createRollingCpuProfileAccumulator(3)

    for (let value = 1; value <= 5; value++) profile.record(sample(value))

    const snapshot = profile.snapshot(false)
    expect(snapshot).toMatchObject({
      version: 1,
      sampleKind: 'rolling-cpu',
      rendererTimingKind: 'cpu-submit',
      capacity: 3,
      totalFrameCount: 5,
      retainedFrameCount: 3,
      currentFrameExcluded: false,
    })
    for (const metric of ROLLING_CPU_PROFILE_METRICS) {
      expect(snapshot.metrics[metric]).toEqual({ count: 3, p50: 4, p95: 5, max: 5 })
    }
  })

  it('空窗口和 reset 都返回无伪造百分位的快照', () => {
    const profile = createRollingCpuProfileAccumulator(2)
    profile.record(sample(1))
    profile.reset()

    const snapshot = profile.snapshot(true)
    expect(snapshot.totalFrameCount).toBe(0)
    expect(snapshot.retainedFrameCount).toBe(0)
    expect(snapshot.currentFrameExcluded).toBe(true)
    for (const metric of ROLLING_CPU_PROFILE_METRICS) {
      expect(snapshot.metrics[metric]).toEqual({ count: 0, p50: null, p95: null, max: null })
    }
  })

  it('拒绝非有限容量并把非正容量收紧为 1', () => {
    expect(() => createRollingCpuProfileAccumulator(Number.NaN)).toThrow(RangeError)
    expect(() => createRollingCpuProfileAccumulator(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(createRollingCpuProfileAccumulator(0).snapshot(false).capacity).toBe(1)
    expect(createRollingCpuProfileAccumulator(-5).snapshot(false).capacity).toBe(1)
  })
})
