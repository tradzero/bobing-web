export const ROLLING_CPU_PROFILE_VERSION = 1

export const ROLLING_CPU_PROFILE_METRICS = [
  'rafRawDeltaMs',
  'rafClampedDeltaMs',
  'cannonStepnumberDelta',
  'worldStepCpuMs',
  'guardCpuMs',
  'rollSafetyCpuMs',
  'settleCpuMs',
  'transformSyncCpuMs',
  'rendererSubmitCpuMs',
  'diagnosticsPublishCpuMs',
  'tickTotalCpuMs',
] as const

export type RollingCpuProfileMetric = (typeof ROLLING_CPU_PROFILE_METRICS)[number]

export type RollingCpuFrameSample = Record<RollingCpuProfileMetric, number>

export interface RollingCpuMetricDistribution {
  count: number
  p50: number | null
  p95: number | null
  max: number | null
}

export interface RollingCpuProfileSnapshot {
  version: typeof ROLLING_CPU_PROFILE_VERSION
  sampleKind: 'rolling-cpu'
  /** renderer.render() 的同步 CPU 提交耗时，不代表 GPU 执行时间。 */
  rendererTimingKind: 'cpu-submit'
  capacity: number
  totalFrameCount: number
  retainedFrameCount: number
  /** post-render 发布发生在当前帧计时完成前，因此发布快照不含当前帧。 */
  currentFrameExcluded: boolean
  metrics: Record<RollingCpuProfileMetric, RollingCpuMetricDistribution>
}

export interface RollingCpuProfileAccumulator {
  record: (sample: RollingCpuFrameSample) => void
  reset: () => void
  snapshot: (currentFrameExcluded: boolean) => RollingCpuProfileSnapshot
}

const DEFAULT_CAPACITY = 600

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

/** 固定容量的只读性能采样器；只在显式 e2e profile 模式创建。 */
export function createRollingCpuProfileAccumulator(
  requestedCapacity = DEFAULT_CAPACITY,
): RollingCpuProfileAccumulator {
  if (!Number.isFinite(requestedCapacity)) {
    throw new RangeError(`rolling CPU profile capacity 必须是有限数字，收到 ${requestedCapacity}`)
  }
  const capacity = Math.max(1, Math.floor(requestedCapacity))
  const samples: RollingCpuFrameSample[] = []
  let totalFrameCount = 0

  return {
    record(sample) {
      totalFrameCount++
      samples.push({ ...sample })
      if (samples.length > capacity) samples.shift()
    },

    reset() {
      samples.length = 0
      totalFrameCount = 0
    },

    snapshot(currentFrameExcluded) {
      const metrics = {} as Record<RollingCpuProfileMetric, RollingCpuMetricDistribution>
      for (const metric of ROLLING_CPU_PROFILE_METRICS) {
        const values = samples.map((sample) => sample[metric]).sort((a, b) => a - b)
        metrics[metric] = {
          count: values.length,
          p50: percentile(values, 0.5),
          p95: percentile(values, 0.95),
          max: values.at(-1) ?? null,
        }
      }

      return {
        version: ROLLING_CPU_PROFILE_VERSION,
        sampleKind: 'rolling-cpu',
        rendererTimingKind: 'cpu-submit',
        capacity,
        totalFrameCount,
        retainedFrameCount: samples.length,
        currentFrameExcluded,
        metrics,
      }
    },
  }
}
