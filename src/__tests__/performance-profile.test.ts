import { describe, expect, it } from 'vitest'
import {
  MAX_ROLLING_CPU_PROFILE_CAPACITY,
  ROLLING_CPU_PROFILE_METRICS,
  ROLLING_CPU_SEGMENT_METRICS,
  createRollingCpuProfileAccumulator,
  type RollingCpuFrameSample,
} from '@/game/performance-profile'

function sample(value: number): RollingCpuFrameSample {
  return {
    simulationStep: value,
    simulationTime: value / 10,
    rafRawDeltaMs: value,
    rafClampedDeltaMs: value,
    cannonStepnumberDelta: value,
    executedSteps: value,
    queuedMs: value,
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
      version: 2,
      sampleKind: 'rolling-cpu',
      rendererTimingKind: 'cpu-submit',
      capacity: 3,
      totalFrameCount: 5,
      retainedFrameCount: 3,
      totalExactStepCount: 0,
      retainedExactStepCount: 0,
      currentFrameExcluded: false,
    })
    expect(snapshot.rawFrameSamples.map(({ executedSteps }) => executedSteps)).toEqual([3, 4, 5])
    expect(snapshot.exactStepSamples).toEqual([])
    expect(snapshot.phaseSegments).toBeNull()
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
    expect(snapshot.rawFrameSamples).toEqual([])
    expect(snapshot.exactStepSamples).toEqual([])
    expect(snapshot.phaseSegments).toBeNull()
    for (const metric of ROLLING_CPU_PROFILE_METRICS) {
      expect(snapshot.metrics[metric]).toEqual({ count: 0, p50: null, p95: null, max: null })
    }
  })

  it('拒绝非有限容量并把非正容量收紧为 1', () => {
    expect(() => createRollingCpuProfileAccumulator(Number.NaN)).toThrow(RangeError)
    expect(() => createRollingCpuProfileAccumulator(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(createRollingCpuProfileAccumulator(0).snapshot(false).capacity).toBe(1)
    expect(createRollingCpuProfileAccumulator(-5).snapshot(false).capacity).toBe(1)
    expect(createRollingCpuProfileAccumulator(10_000).snapshot(false).capacity).toBe(
      MAX_ROLLING_CPU_PROFILE_CAPACITY,
    )
  })

  it('按逐 exact-step 首次接触和结算时间派生允许重叠的三段帧分布', () => {
    const profile = createRollingCpuProfileAccumulator()
    const frameTimes = [0.1, 0.2, 0.4, 0.6, 0.8]
    for (const [index, simulationTime] of frameTimes.entries()) {
      const frame = sample(index + 1)
      frame.simulationStep = Math.round(simulationTime * 60)
      frame.simulationTime = simulationTime
      profile.record(frame)
    }
    for (let simulationStep = 1; simulationStep <= 48; simulationStep++) {
      profile.recordExactStep({
        simulationStep,
        simulationTime: simulationStep / 60,
        contactCount: simulationStep >= 12 ? 2 : 0,
        contactEquationCount: simulationStep >= 12 ? 2 : 0,
        frictionEquationCount: simulationStep >= 12 ? 4 : 0,
        awakeDiceCount: simulationStep < 48 ? 6 : 0,
        broadphaseCpuMs: 0.1,
        narrowphaseCpuMs: 0.2,
        makeContactConstraintsCpuMs: 0.3,
        solveCpuMs: 0.4,
        integrateCpuMs: 0.5,
        settled: simulationStep === 48,
      })
    }

    const snapshot = profile.snapshot(false)
    expect(snapshot.totalExactStepCount).toBe(48)
    expect(snapshot.exactStepSamples).toHaveLength(48)
    expect(snapshot.phaseSegments).toMatchObject({
      overlapAllowed: true,
      frameClassification: 'end-simulation-time',
      firstContact: { simulationStep: 12, simulationTime: 0.2 },
      settlement: { simulationStep: 48, simulationTime: 0.8 },
      airborne: { startSimulationTime: 0, endSimulationTime: 0.2, sampleCount: 1 },
      impactWindow: { startSimulationTime: 0.2, endSimulationTime: 0.7, sampleCount: 3 },
      tail: { endSimulationTime: 0.8, sampleCount: 3 },
    })
    expect(snapshot.phaseSegments!.tail.startSimulationTime).toBeCloseTo(0.3, 12)
    for (const segment of [
      snapshot.phaseSegments!.airborne,
      snapshot.phaseSegments!.impactWindow,
      snapshot.phaseSegments!.tail,
    ]) {
      for (const metric of ROLLING_CPU_SEGMENT_METRICS) {
        expect(segment.metrics[metric].count).toBe(segment.sampleCount)
      }
    }
  })

  it('无接触时 impact 显式为空，缺少可分类帧时 tail 不伪造 0ms', () => {
    const profile = createRollingCpuProfileAccumulator()
    profile.record({ ...sample(1), simulationStep: null, simulationTime: null })
    profile.recordExactStep({
      simulationStep: 1,
      simulationTime: 1 / 60,
      contactCount: 0,
      contactEquationCount: 0,
      frictionEquationCount: 0,
      awakeDiceCount: 6,
      broadphaseCpuMs: 0,
      narrowphaseCpuMs: 0,
      makeContactConstraintsCpuMs: 0,
      solveCpuMs: 0,
      integrateCpuMs: 0,
      settled: true,
    })

    const segments = profile.snapshot(false).phaseSegments!
    expect(segments.firstContact).toBeNull()
    expect(segments.impactWindow).toMatchObject({
      startSimulationTime: null,
      endSimulationTime: null,
      sampleCount: 0,
    })
    expect(segments.tail).toMatchObject({
      startSimulationTime: null,
      endSimulationTime: null,
      sampleCount: 0,
    })
    for (const segment of [segments.impactWindow, segments.tail]) {
      for (const metric of ROLLING_CPU_SEGMENT_METRICS) {
        expect(segment.metrics[metric]).toEqual({ count: 0, p50: null, p95: null, max: null })
      }
    }
  })
})
