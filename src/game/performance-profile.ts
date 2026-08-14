export const ROLLING_CPU_PROFILE_VERSION = 2

export const ROLLING_CPU_PROFILE_METRICS = [
  'rafRawDeltaMs',
  'rafClampedDeltaMs',
  'cannonStepnumberDelta',
  'executedSteps',
  'queuedMs',
  'worldStepCpuMs',
  'guardCpuMs',
  'rollSafetyCpuMs',
  'settleCpuMs',
  'transformSyncCpuMs',
  'rendererSubmitCpuMs',
  'diagnosticsPublishCpuMs',
  'tickTotalCpuMs',
] as const

export const ROLLING_CPU_SEGMENT_METRICS = [
  'worldStepCpuMs',
  'tickTotalCpuMs',
  'rendererSubmitCpuMs',
  'executedSteps',
] as const

export type RollingCpuProfileMetric = (typeof ROLLING_CPU_PROFILE_METRICS)[number]
export type RollingCpuSegmentMetric = (typeof ROLLING_CPU_SEGMENT_METRICS)[number]

export interface RollingCpuFrameSample extends Record<RollingCpuProfileMetric, number> {
  /** 当前 rAF 完成后 exact session 的进度；legacy profile 明确为 null。 */
  simulationStep: number | null
  simulationTime: number | null
}

export interface RollingCpuExactStepSample {
  simulationStep: number
  simulationTime: number
  /** 当前 Cannon contact equation 中至少一端是骰子的数量。 */
  contactCount: number
  /** 当前 Cannon world 的完整 contact/friction equation 数量。 */
  contactEquationCount: number
  frictionEquationCount: number
  /** sleepState 严格为 AWAKE 的骰子数，不把 SLEEPY 算作 awake。 */
  awakeDiceCount: number
  /** Cannon 内建 doProfiling 对单次 internalStep 的五段 CPU 计时，单位毫秒。 */
  broadphaseCpuMs: number
  narrowphaseCpuMs: number
  makeContactConstraintsCpuMs: number
  solveCpuMs: number
  integrateCpuMs: number
  /** 该步是否产生了 settlement 结果（包括显式 timeout）。 */
  settled: boolean
}

export interface RollingCpuMetricDistribution {
  count: number
  p50: number | null
  p95: number | null
  max: number | null
}

export interface RollingCpuSimulationPoint {
  simulationStep: number
  simulationTime: number
}

export interface RollingCpuSegmentSnapshot {
  /** 窗口边界按每帧结束时的 simulationTime 分类。 */
  startSimulationTime: number | null
  endSimulationTime: number | null
  sampleCount: number
  metrics: Record<RollingCpuSegmentMetric, RollingCpuMetricDistribution>
}

export interface RollingCpuPhaseSegmentsSnapshot {
  /** 同一帧可以同时属于 impact-window 与 tail；两段不可相加为整轮成本。 */
  overlapAllowed: true
  frameClassification: 'end-simulation-time'
  impactWindowMs: 500
  tailWindowMs: 500
  firstContact: RollingCpuSimulationPoint | null
  settlement: RollingCpuSimulationPoint | null
  airborne: RollingCpuSegmentSnapshot
  impactWindow: RollingCpuSegmentSnapshot
  tail: RollingCpuSegmentSnapshot
}

export interface RollingCpuProfileSnapshot {
  version: typeof ROLLING_CPU_PROFILE_VERSION
  sampleKind: 'rolling-cpu'
  /** renderer.render() 的同步 CPU 提交耗时，不代表 GPU 执行时间。 */
  rendererTimingKind: 'cpu-submit'
  capacity: number
  totalFrameCount: number
  retainedFrameCount: number
  totalExactStepCount: number
  retainedExactStepCount: number
  /** post-render 发布发生在当前帧计时完成前，因此发布快照不含当前帧。 */
  currentFrameExcluded: boolean
  metrics: Record<RollingCpuProfileMetric, RollingCpuMetricDistribution>
  /** 最近不超过 capacity（且 capacity 最大 600）的逐 rAF 原始样本。 */
  rawFrameSamples: RollingCpuFrameSample[]
  /** 最近不超过 capacity 的逐 exact-step 接触/唤醒状态；legacy 调度为空。 */
  exactStepSamples: RollingCpuExactStepSample[]
  /** 只有 exact step 产生 settlement 后才派生；未结算明确为 null。 */
  phaseSegments: RollingCpuPhaseSegmentsSnapshot | null
}

export interface RollingCpuProfileAccumulator {
  record: (sample: RollingCpuFrameSample) => void
  recordExactStep: (sample: RollingCpuExactStepSample) => void
  reset: () => void
  snapshot: (currentFrameExcluded: boolean) => RollingCpuProfileSnapshot
}

const DEFAULT_CAPACITY = 600
export const MAX_ROLLING_CPU_PROFILE_CAPACITY = 600
const IMPACT_WINDOW_SECONDS = 0.5
const TAIL_WINDOW_SECONDS = 0.5

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function distribution(values: readonly number[]): RollingCpuMetricDistribution {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? null,
  }
}

function emptySegment(): RollingCpuSegmentSnapshot {
  const metrics = {} as Record<RollingCpuSegmentMetric, RollingCpuMetricDistribution>
  for (const metric of ROLLING_CPU_SEGMENT_METRICS) metrics[metric] = distribution([])
  return {
    startSimulationTime: null,
    endSimulationTime: null,
    sampleCount: 0,
    metrics,
  }
}

function createSegment(
  samples: readonly RollingCpuFrameSample[],
  startSimulationTime: number,
  endSimulationTime: number,
): RollingCpuSegmentSnapshot {
  const metrics = {} as Record<RollingCpuSegmentMetric, RollingCpuMetricDistribution>
  for (const metric of ROLLING_CPU_SEGMENT_METRICS) {
    metrics[metric] = distribution(samples.map((sample) => sample[metric]))
  }
  return {
    startSimulationTime,
    endSimulationTime,
    sampleCount: samples.length,
    metrics,
  }
}

function derivePhaseSegments(
  frames: readonly RollingCpuFrameSample[],
  firstContact: RollingCpuSimulationPoint | null,
  settlement: RollingCpuSimulationPoint | null,
): RollingCpuPhaseSegmentsSnapshot | null {
  if (!settlement) return null

  const exactFrames = frames.filter(
    (sample): sample is RollingCpuFrameSample & { simulationTime: number } =>
      sample.simulationTime !== null,
  )
  const airborneFrames = firstContact
    ? exactFrames.filter((sample) => sample.simulationTime < firstContact.simulationTime)
    : exactFrames
  const airborne = createSegment(
    airborneFrames,
    0,
    firstContact?.simulationTime ?? settlement.simulationTime,
  )

  const impactWindow = firstContact
    ? createSegment(
        exactFrames.filter(
          (sample) =>
            sample.simulationTime >= firstContact.simulationTime &&
            sample.simulationTime <= firstContact.simulationTime + IMPACT_WINDOW_SECONDS,
        ),
        firstContact.simulationTime,
        firstContact.simulationTime + IMPACT_WINDOW_SECONDS,
      )
    : emptySegment()

  const tailStart = Math.max(0, settlement.simulationTime - TAIL_WINDOW_SECONDS)
  const tailFrames = exactFrames.filter(
    (sample) =>
      sample.simulationTime >= tailStart && sample.simulationTime <= settlement.simulationTime,
  )
  const tail =
    tailFrames.length > 0
      ? createSegment(tailFrames, tailStart, settlement.simulationTime)
      : emptySegment()

  return {
    overlapAllowed: true,
    frameClassification: 'end-simulation-time',
    impactWindowMs: 500,
    tailWindowMs: 500,
    firstContact,
    settlement,
    airborne,
    impactWindow,
    tail,
  }
}

/** 固定容量的只读性能采样器；只在显式 e2e profile 模式创建。 */
export function createRollingCpuProfileAccumulator(
  requestedCapacity = DEFAULT_CAPACITY,
): RollingCpuProfileAccumulator {
  if (!Number.isFinite(requestedCapacity)) {
    throw new RangeError(`rolling CPU profile capacity 必须是有限数字，收到 ${requestedCapacity}`)
  }
  const capacity = Math.min(
    MAX_ROLLING_CPU_PROFILE_CAPACITY,
    Math.max(1, Math.floor(requestedCapacity)),
  )
  const frameSamples: RollingCpuFrameSample[] = []
  const exactStepSamples: RollingCpuExactStepSample[] = []
  let totalFrameCount = 0
  let totalExactStepCount = 0
  let firstContact: RollingCpuSimulationPoint | null = null
  let settlement: RollingCpuSimulationPoint | null = null

  return {
    record(sample) {
      totalFrameCount++
      frameSamples.push({ ...sample })
      if (frameSamples.length > capacity) frameSamples.shift()
    },

    recordExactStep(sample) {
      totalExactStepCount++
      exactStepSamples.push({ ...sample })
      if (exactStepSamples.length > capacity) exactStepSamples.shift()
      if (!firstContact && sample.contactCount > 0) {
        firstContact = {
          simulationStep: sample.simulationStep,
          simulationTime: sample.simulationTime,
        }
      }
      if (sample.settled) {
        settlement = {
          simulationStep: sample.simulationStep,
          simulationTime: sample.simulationTime,
        }
      }
    },

    reset() {
      frameSamples.length = 0
      exactStepSamples.length = 0
      totalFrameCount = 0
      totalExactStepCount = 0
      firstContact = null
      settlement = null
    },

    snapshot(currentFrameExcluded) {
      const metrics = {} as Record<RollingCpuProfileMetric, RollingCpuMetricDistribution>
      for (const metric of ROLLING_CPU_PROFILE_METRICS) {
        metrics[metric] = distribution(frameSamples.map((sample) => sample[metric]))
      }

      return {
        version: ROLLING_CPU_PROFILE_VERSION,
        sampleKind: 'rolling-cpu',
        rendererTimingKind: 'cpu-submit',
        capacity,
        totalFrameCount,
        retainedFrameCount: frameSamples.length,
        totalExactStepCount,
        retainedExactStepCount: exactStepSamples.length,
        currentFrameExcluded,
        metrics,
        rawFrameSamples: frameSamples.map((sample) => ({ ...sample })),
        exactStepSamples: exactStepSamples.map((sample) => ({ ...sample })),
        phaseSegments: derivePhaseSegments(frameSamples, firstContact, settlement),
      }
    },
  }
}
