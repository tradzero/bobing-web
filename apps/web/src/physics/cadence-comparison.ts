import {
  PHYSICS_CADENCE_OVERLOAD_HIGH_WATER_MS,
  type PhysicsCadenceId,
  type PhysicsCadenceSchedulerId,
} from '@/config/physics-cadence'
import { judge } from '@dice/game-domain'
import { WALL_RADIUS } from './bowl-body'
import {
  runCadenceRoll,
  type CadenceRollOptions,
  type CadenceRollReport,
  type SettledCadenceRollReport,
} from './cadence-roll-runner'
import type { RollRunResult } from '@dice/physics-core'

/** cadence comparison report、计划或 gate 语义发生不兼容变化时必须递增。 */
export const CADENCE_COMPARISON_SCHEMA_VERSION = 1
export const CADENCE_EXECUTION_PLAN_VERSION = 1

export const CADENCE_DEFAULT_TOTAL_SEEDS = 200
export const CADENCE_DEFAULT_BASE_SEED = 50_000
export const CADENCE_MAX_CONTACT_PENETRATION = 0.1

export const CADENCE_WATCH_SEEDS = Object.freeze([
  1, 13, 42, 25_042, 5_555, 7_777, 12_345, 65_000, 65_535, 67_000, 72_000, 99_999, 208_000, 212_000,
  314_159, 1_673_000, 2_718_281, 1_776_219_009_201, 1_776_310_976_115, 1_776_311_021_115,
])

export const CADENCE_NORMAL_IDS = Object.freeze([
  'steady60',
  'steady30',
  'deterministic-jitter',
  'isolated100ms',
  'visibility-suspend',
] as const satisfies readonly PhysicsCadenceId[])

export const CADENCE_CANDIDATE_SCHEDULERS = Object.freeze([
  'exact-cap6',
  'exact-cap4',
] as const satisfies readonly PhysicsCadenceSchedulerId[])

export type CadenceComparisonCohort = 'watch-normal' | 'batch-normal' | 'watch-overload'
export type CadenceComparisonRole = 'reference' | 'candidate' | 'overload'

export interface CadenceComparisonRequest {
  totalSeeds: number
  baseSeed: number
  watchOnly: boolean
  seed?: number
}

export interface CadenceComparisonExecution {
  sequence: number
  cohort: CadenceComparisonCohort
  role: CadenceComparisonRole
  seed: number
  cadence: PhysicsCadenceId
  scheduler: PhysicsCadenceSchedulerId
}

export interface CadenceComparisonPlan {
  version: typeof CADENCE_EXECUTION_PLAN_VERSION
  reference: Readonly<Pick<CadenceComparisonExecution, 'cadence' | 'scheduler'>>
  normalCadences: readonly PhysicsCadenceId[]
  candidateSchedulers: readonly PhysicsCadenceSchedulerId[]
  overload: Readonly<Pick<CadenceComparisonExecution, 'cadence' | 'scheduler'>>
  watchSeeds: number[]
  batchSeeds: number[]
  totalSeeds: number
  comparisonCount: number
  expectedRunCount: number
  executions: CadenceComparisonExecution[]
}

export type CadenceComparisonFailureCode =
  | 'reference-run-error'
  | 'candidate-run-error'
  | 'overload-run-error'
  | 'unexpected-outcome'
  | 'roll-missing'
  | 'initial-state-diff'
  | 'final-state-diff'
  | 'roll-result-diff'
  | 'judge-diff'
  | 'safety-nan'
  | 'safety-wall-crossing'
  | 'safety-conservative-boundary'
  | 'safety-max-radius'
  | 'safety-escape-guard'
  | 'safety-assist'
  | 'safety-floor-unavailable'
  | 'safety-floor-relaunch'
  | 'safety-timeout'
  | 'safety-budget'
  | 'safety-cluster-assist'
  | 'safety-invalid-faces'
  | 'safety-nonfinite-state'
  | 'safety-contact-penetration'
  | 'conservation-failed'
  | 'session-timing-diff'
  | 'overload-missing'
  | 'overload-roll-present'
  | 'overload-queue'
  | 'overload-partial-safety'
  | 'execution-count-mismatch'
  | 'repository-state-changed'
  | 'repository-not-clean'

export interface CadenceComparisonFailure {
  code: CadenceComparisonFailureCode
  cohort: CadenceComparisonCohort | 'global'
  seed: number | null
  cadence: PhysicsCadenceId | null
  scheduler: PhysicsCadenceSchedulerId | null
  role: CadenceComparisonRole | 'global'
  path?: string
  expected?: unknown
  actual?: unknown
  message: string
}

export interface CadenceComparisonObservation {
  cohort: Exclude<CadenceComparisonCohort, 'watch-overload'>
  seed: number
  cadence: PhysicsCadenceId
  scheduler: Exclude<PhysicsCadenceSchedulerId, 'reference-exact'>
  passed: boolean
  reference: CadenceCompactRun
  candidate: CadenceCompactRun
  equal: {
    initialState: boolean
    finalState: boolean
    rollResult: boolean
    judgeResult: boolean
  }
  failureCodes: CadenceComparisonFailureCode[]
}

export interface CadenceOverloadObservation {
  cohort: 'watch-overload'
  seed: number
  cadence: 'sustained100ms'
  scheduler: 'exact-cap4'
  passed: boolean
  run: CadenceCompactRun
  failureCodes: CadenceComparisonFailureCode[]
}

export interface CadenceCompactRun {
  outcome: CadenceRollReport['outcome'] | 'run-error'
  initialStateHash: string | null
  finalStateHash: string | null
  settleReason: RollRunResult['settleReason'] | null
  simulationStep: number | null
  simulationTime: number | null
  frameCount: number | null
  peakQueuedMs: number | null
  queuedMs: number | null
  queuedWholeSteps: number | null
  abandonedQueuedMs: number | null
  totalRawWallDeltaMs: number | null
  totalAcceptedWallDeltaMs: number | null
  totalPausedWallDeltaMs: number | null
  totalDiscardedWallDeltaMs: number | null
  maxFrameConservationErrorMs: number | null
  maxTotalConservationErrorMs: number | null
  conservationPassed: boolean | null
  error: string | null
}

export interface CadenceCandidateGroupSummary {
  cadence: PhysicsCadenceId
  scheduler: Exclude<PhysicsCadenceSchedulerId, 'reference-exact'>
  sampleCount: number
  excludedFailedCount: number
  queueMs: { p50: number; p95: number; max: number }
  abandonedQueuedMs: { p50: number; p95: number; max: number }
  wallTotalsMs: { raw: number; accepted: number; paused: number; discarded: number }
  maxConservationErrorMs: number
}

export interface CadenceCohortSummary {
  seedCount: number
  comparisonCount: number
  passedCount: number
  failedCount: number
  failureSeeds: number[]
  /** normal cohort 只聚合 candidate，避免重复计入每 seed 的 reference。 */
  candidateGroups: CadenceCandidateGroupSummary[]
}

export interface CadenceComparisonCoreReport {
  schemaVersion: typeof CADENCE_COMPARISON_SCHEMA_VERSION
  plan: CadenceComparisonPlan
  cohorts: Record<CadenceComparisonCohort, CadenceCohortSummary>
  summary: {
    passed: boolean
    expectedRunCount: number
    actualRunCount: number
    comparisonCount: number
    overloadCheckCount: number
    failureCount: number
  }
  comparisons: CadenceComparisonObservation[]
  overloadChecks: CadenceOverloadObservation[]
  failures: CadenceComparisonFailure[]
  failureSeeds: number[]
}

export interface ExecuteCadenceComparisonOptions {
  plan: CadenceComparisonPlan
  runCadenceRoll?: (options: CadenceRollOptions) => CadenceRollReport
  onProgress?: (
    completedRuns: number,
    expectedRuns: number,
    execution: CadenceComparisonExecution,
  ) => void
}

interface RunRecord {
  execution: CadenceComparisonExecution
  report: CadenceRollReport | null
  error: string | null
}

/** Roll/canonical state 只含 JSON-like 数据；显式比较保留 Object.is 的 -0/NaN 语义。 */
function exactDeepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== typeof right || left === null || right === null) return false
  if (typeof left !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => exactDeepEqual(value, right[index]))
    )
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        exactDeepEqual(leftRecord[key], rightRecord[key]),
    )
  )
}

function requireSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} 必须是安全整数，收到 ${value}`)
}

function requirePositiveSafeInteger(value: number, label: string): void {
  requireSafeInteger(value, label)
  if (value <= 0) throw new RangeError(`${label} 必须是正整数，收到 ${value}`)
}

function buildSeedSet(request: CadenceComparisonRequest): {
  watchSeeds: number[]
  batchSeeds: number[]
} {
  if (request.seed !== undefined) {
    requireSafeInteger(request.seed, 'seed')
    return { watchSeeds: [request.seed], batchSeeds: [] }
  }

  requirePositiveSafeInteger(request.totalSeeds, 'totalSeeds')
  requireSafeInteger(request.baseSeed, 'baseSeed')
  const watchSeeds = [...CADENCE_WATCH_SEEDS]
  if (request.watchOnly) return { watchSeeds, batchSeeds: [] }
  if (request.totalSeeds < watchSeeds.length) {
    throw new RangeError(
      `totalSeeds=${request.totalSeeds} 小于固定 watch seed 数量 ${watchSeeds.length}`,
    )
  }

  const seen = new Set(watchSeeds)
  const batchSeeds: number[] = []
  let index = 0
  while (watchSeeds.length + batchSeeds.length < request.totalSeeds) {
    const seed = request.baseSeed + index * 1_000
    requireSafeInteger(seed, 'generated seed')
    if (!seen.has(seed)) {
      seen.add(seed)
      batchSeeds.push(seed)
    }
    index++
  }
  return { watchSeeds, batchSeeds }
}

/**
 * watch 跑完整 normal matrix；batch 按 ordinal 平衡分配一种 cadence，但两种 cap 都跑。
 * 每个 seed 的 reference 只执行一次，避免把 reference 乘进 cadence 矩阵。
 */
export function createCadenceComparisonPlan(
  request: CadenceComparisonRequest,
): CadenceComparisonPlan {
  const { watchSeeds, batchSeeds } = buildSeedSet(request)
  const executions: CadenceComparisonExecution[] = []
  let comparisonCount = 0

  const push = (
    cohort: CadenceComparisonCohort,
    role: CadenceComparisonRole,
    seed: number,
    cadence: PhysicsCadenceId,
    scheduler: PhysicsCadenceSchedulerId,
  ) => {
    executions.push({ sequence: executions.length, cohort, role, seed, cadence, scheduler })
  }

  for (const seed of watchSeeds) {
    push('watch-normal', 'reference', seed, 'steady60', 'reference-exact')
    for (const cadence of CADENCE_NORMAL_IDS) {
      for (const scheduler of CADENCE_CANDIDATE_SCHEDULERS) {
        push('watch-normal', 'candidate', seed, cadence, scheduler)
        comparisonCount++
      }
    }
    push('watch-overload', 'overload', seed, 'sustained100ms', 'exact-cap4')
  }

  for (let ordinal = 0; ordinal < batchSeeds.length; ordinal++) {
    const seed = batchSeeds[ordinal]
    const cadence = CADENCE_NORMAL_IDS[ordinal % CADENCE_NORMAL_IDS.length]
    push('batch-normal', 'reference', seed, 'steady60', 'reference-exact')
    for (const scheduler of CADENCE_CANDIDATE_SCHEDULERS) {
      push('batch-normal', 'candidate', seed, cadence, scheduler)
      comparisonCount++
    }
  }

  return {
    version: CADENCE_EXECUTION_PLAN_VERSION,
    reference: { cadence: 'steady60', scheduler: 'reference-exact' },
    normalCadences: [...CADENCE_NORMAL_IDS],
    candidateSchedulers: [...CADENCE_CANDIDATE_SCHEDULERS],
    overload: { cadence: 'sustained100ms', scheduler: 'exact-cap4' },
    watchSeeds,
    batchSeeds,
    totalSeeds: watchSeeds.length + batchSeeds.length,
    comparisonCount,
    expectedRunCount: executions.length,
    executions,
  }
}

function failure(
  failures: CadenceComparisonFailure[],
  execution: CadenceComparisonExecution,
  code: CadenceComparisonFailureCode,
  message: string,
  details?: Pick<CadenceComparisonFailure, 'path' | 'expected' | 'actual'>,
): void {
  failures.push({
    code,
    cohort: execution.cohort,
    seed: execution.seed,
    cadence: execution.cadence,
    scheduler: execution.scheduler,
    role: execution.role,
    message,
    ...details,
  })
}

function validCanonicalState(state: RollRunResult['finalState']): boolean {
  return (
    state.bodies.length === 6 &&
    /^[0-9a-f]{16}$/.test(state.hash) &&
    state.bodies.every((body) =>
      [...body.position, ...body.quaternion, ...body.velocity, ...body.angularVelocity].every(
        Number.isFinite,
      ),
    )
  )
}

function validFaces(result: RollRunResult): boolean {
  return (
    result.finalFaces.length === 6 &&
    result.finalFaces.every(
      ({ value, confidence }) =>
        Number.isInteger(value) && value >= 1 && value <= 6 && Number.isFinite(confidence),
    )
  )
}

function validateNormalRun(
  record: RunRecord,
  failures: CadenceComparisonFailure[],
): record is RunRecord & { report: SettledCadenceRollReport } {
  const { execution, report } = record
  if (record.error || !report) {
    failure(
      failures,
      execution,
      execution.role === 'reference' ? 'reference-run-error' : 'candidate-run-error',
      record.error ?? 'cadence run 未返回报告',
    )
    return false
  }
  if (report.outcome !== 'settled') {
    failure(failures, execution, 'unexpected-outcome', `正常 cadence 返回 ${report.outcome}`, {
      expected: 'settled',
      actual: report.outcome,
    })
    failure(failures, execution, 'roll-missing', '正常 cadence 未生成 RollRunResult')
    return false
  }

  const { roll } = report
  const finiteRollMetrics = [
    roll.maxRadius,
    roll.maxHeight,
    roll.maxSpeed,
    roll.maxAngularSpeed,
    roll.maxContactPenetration,
    roll.finalRadius,
    roll.finalMaxSpeed,
    roll.finalMaxAngularSpeed,
    roll.settleTime,
    roll.simulationTime,
  ].every(Number.isFinite)
  if (roll.nanDetected) failure(failures, execution, 'safety-nan', '物理状态出现 NaN')
  if (roll.wallCenterCrossings > 0) {
    failure(failures, execution, 'safety-wall-crossing', '骰子中心越过物理挡墙')
  }
  if (roll.conservativeBoundaryCrossings > 0) {
    failure(failures, execution, 'safety-conservative-boundary', '骰子越过保守完整包络边界')
  }
  if (!(roll.maxRadius < WALL_RADIUS)) {
    failure(
      failures,
      execution,
      'safety-max-radius',
      `maxRadius=${roll.maxRadius} 越过真实挡墙半径`,
    )
  }
  if (roll.escapeGuardInterventionCount > 0) {
    failure(failures, execution, 'safety-escape-guard', '触发 escape guard')
  }
  if (roll.assistInterventionCount > 0) {
    failure(failures, execution, 'safety-assist', '触发 contact-cluster assist')
  }
  if (!roll.floorRelaunch.available) {
    failure(failures, execution, 'safety-floor-unavailable', 'floor relaunch tracker 不可用')
  }
  if (roll.floorRelaunch.relaunchEventCount > 0) {
    failure(failures, execution, 'safety-floor-relaunch', '检测到异常碗底二次发射')
  }
  if (roll.settleReason === 'timeout') {
    failure(failures, execution, 'safety-timeout', '正常 cadence 以 timeout 终止')
  }
  if (
    roll.settleReason === 'frame-budget-exhausted' ||
    roll.settleReason === 'continuation-budget-exhausted' ||
    roll.settleFrame <= 0
  ) {
    failure(failures, execution, 'safety-budget', '正常 cadence 耗尽模拟预算')
  }
  if (roll.settleReason === 'cluster-assist') {
    failure(failures, execution, 'safety-cluster-assist', '正常 cadence 以人工 assist 结算')
  }
  if (!validFaces(roll)) {
    failure(failures, execution, 'safety-invalid-faces', '终态不是 6 个合法骰面')
  }
  if (
    !finiteRollMetrics ||
    !validCanonicalState(report.initialState) ||
    !validCanonicalState(roll.finalState)
  ) {
    failure(
      failures,
      execution,
      'safety-nonfinite-state',
      '物理指标、canonical 初态或终态不完整或含非有限值',
    )
  }
  if (roll.maxContactPenetration > CADENCE_MAX_CONTACT_PENETRATION) {
    failure(
      failures,
      execution,
      'safety-contact-penetration',
      `maxContactPenetration=${roll.maxContactPenetration} 超过 ${CADENCE_MAX_CONTACT_PENETRATION}`,
    )
  }
  if (!report.conservation.passed || report.timing.frameInProgress) {
    failure(failures, execution, 'conservation-failed', 'accumulator time conservation 未通过')
  }
  const timeToleranceMs = report.conservation.totalToleranceMs
  const sessionTimingValid =
    report.timing.totalExecutedSteps === roll.simulationStep &&
    Math.abs(report.timing.totalExecutedSimulationMs - roll.simulationTime * 1_000) <=
      timeToleranceMs &&
    roll.settleFrame === roll.simulationStep &&
    Math.abs(roll.settleTime - roll.simulationTime) <= timeToleranceMs / 1_000 &&
    report.abandonedBacklog.countedAsDiscarded === false
  if (!sessionTimingValid) {
    failure(failures, execution, 'session-timing-diff', 'accumulator/session/settlement 时间不一致')
  }
  return true
}

function compactRun(record: RunRecord): CadenceCompactRun {
  const report = record.report
  const partial = report?.partialDiagnostics
  const frameConservationErrors = report
    ? [
        report.conservation.maxFrameRawBalanceErrorMs,
        report.conservation.maxFrameDiscardBalanceErrorMs,
        report.conservation.maxFrameQueueBalanceErrorMs,
      ]
    : []
  return {
    outcome: report?.outcome ?? 'run-error',
    initialStateHash: report?.initialState.hash ?? null,
    finalStateHash: report?.roll?.finalState.hash ?? null,
    settleReason: report?.roll?.settleReason ?? null,
    simulationStep: report?.roll?.simulationStep ?? partial?.simulationStep ?? null,
    simulationTime: report?.roll?.simulationTime ?? partial?.simulationTime ?? null,
    frameCount: report?.frames.length ?? null,
    peakQueuedMs:
      report === null
        ? null
        : Math.max(
            0,
            ...report.frames.flatMap((frame) => [
              frame.queueBeforeMs + frame.acceptedWallDeltaMs,
              frame.queuedMs,
            ]),
            report.timing.queuedMs,
          ),
    queuedMs: report?.timing.queuedMs ?? null,
    queuedWholeSteps: report?.timing.queuedWholeSteps ?? null,
    abandonedQueuedMs: report?.abandonedBacklog.queuedMs ?? null,
    totalRawWallDeltaMs: report?.timing.totalRawWallDeltaMs ?? null,
    totalAcceptedWallDeltaMs: report?.timing.totalAcceptedWallDeltaMs ?? null,
    totalPausedWallDeltaMs: report?.timing.totalPausedWallDeltaMs ?? null,
    totalDiscardedWallDeltaMs: report?.timing.totalDiscardedWallDeltaMs ?? null,
    maxFrameConservationErrorMs:
      frameConservationErrors.length === 0 ? null : Math.max(...frameConservationErrors),
    maxTotalConservationErrorMs:
      report === null
        ? null
        : Math.max(
            report.conservation.totalRawBalanceErrorMs,
            report.conservation.totalQueueBalanceErrorMs,
          ),
    conservationPassed: report?.conservation.passed ?? null,
    error: record.error,
  }
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function distribution(values: readonly number[]): { p50: number; p95: number; max: number } {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(0, ...values),
  }
}

function candidateGroups(
  entries: readonly CadenceComparisonObservation[],
): CadenceCandidateGroupSummary[] {
  const groups = new Map<string, CadenceComparisonObservation[]>()
  for (const entry of entries) {
    const key = `${entry.cadence}/${entry.scheduler}`
    const values = groups.get(key) ?? []
    values.push(entry)
    groups.set(key, values)
  }
  return [...groups.values()].map((values) => {
    const [{ cadence, scheduler }] = values
    const passedValues = values.filter(({ passed }) => passed)
    const compact = passedValues.map(({ candidate }) => candidate)
    const finite = (value: number | null): value is number =>
      value !== null && Number.isFinite(value)
    const metric = (key: 'peakQueuedMs' | 'abandonedQueuedMs') =>
      compact.map((value) => value[key]).filter(finite)
    const total = (
      key:
        | 'totalRawWallDeltaMs'
        | 'totalAcceptedWallDeltaMs'
        | 'totalPausedWallDeltaMs'
        | 'totalDiscardedWallDeltaMs',
    ) =>
      compact
        .map((value) => value[key])
        .filter(finite)
        .reduce((sum, value) => sum + value, 0)
    return {
      cadence,
      scheduler,
      sampleCount: passedValues.length,
      excludedFailedCount: values.length - passedValues.length,
      queueMs: distribution(metric('peakQueuedMs')),
      abandonedQueuedMs: distribution(metric('abandonedQueuedMs')),
      wallTotalsMs: {
        raw: total('totalRawWallDeltaMs'),
        accepted: total('totalAcceptedWallDeltaMs'),
        paused: total('totalPausedWallDeltaMs'),
        discarded: total('totalDiscardedWallDeltaMs'),
      },
      maxConservationErrorMs: Math.max(
        0,
        ...compact.flatMap(({ maxFrameConservationErrorMs, maxTotalConservationErrorMs }) =>
          [maxFrameConservationErrorMs, maxTotalConservationErrorMs].filter(finite),
        ),
      ),
    }
  })
}

function validateOverloadRun(
  record: RunRecord,
  failures: CadenceComparisonFailure[],
): CadenceOverloadObservation {
  const start = failures.length
  const { execution, report } = record
  if (record.error || !report) {
    failure(failures, execution, 'overload-run-error', record.error ?? 'overload run 未返回报告')
  } else {
    if (report.outcome !== 'timing-overload') {
      failure(
        failures,
        execution,
        'overload-missing',
        `预期 timing-overload，实际 ${report.outcome}`,
      )
    }
    if (report.roll !== null) {
      failure(
        failures,
        execution,
        'overload-roll-present',
        'timing-overload 不得生成 RollRunResult',
      )
    }
    const last = report.frames.at(-1)
    const toleranceMs = report.conservation.totalToleranceMs
    const expectedQueuedMs = 800 / 3
    const priorFrames = report.frames.slice(0, -1)
    const queueValid =
      report.timing.overload.active &&
      report.timing.totalFrameCount === 6 &&
      report.frames.length === 6 &&
      report.timing.totalExecutedSteps === 20 &&
      Math.abs(report.timing.totalAcceptedWallDeltaMs - 600) <= toleranceMs &&
      Math.abs(report.timing.totalRawWallDeltaMs - 600) <= toleranceMs &&
      Math.abs(report.timing.totalPausedWallDeltaMs) <= toleranceMs &&
      Math.abs(report.timing.totalDiscardedWallDeltaMs) <= toleranceMs &&
      report.timing.queuedMs > PHYSICS_CADENCE_OVERLOAD_HIGH_WATER_MS &&
      Math.abs(report.timing.queuedMs - expectedQueuedMs) <= toleranceMs &&
      report.abandonedBacklog.countedAsDiscarded === false &&
      report.abandonedBacklog.queuedMs === report.timing.queuedMs &&
      priorFrames.every(({ overload }) => !overload.active) &&
      last?.terminalKind === 'timing-overload' &&
      last.rawWallDeltaMs === 100 &&
      last.acceptedWallDeltaMs === 100 &&
      last.overload.enteredThisFrame &&
      last.maxExecutableSteps === 0 &&
      last.executedSteps === 0
    if (!queueValid) {
      failure(
        failures,
        execution,
        'overload-queue',
        'overload 未满足 cadence schema v1 的 frame6/step20/queue/末帧契约',
      )
    }
    const partial = report.partialDiagnostics
    const partialSafetyValid =
      partial !== null &&
      report.conservation.passed &&
      !partial.nanDetected &&
      partial.wallCenterCrossings === 0 &&
      partial.conservativeBoundaryCrossings === 0 &&
      partial.maxRadius < WALL_RADIUS &&
      partial.escapeGuardInterventionCount === 0 &&
      partial.assistInterventionCount === 0 &&
      partial.maxContactPenetration <= CADENCE_MAX_CONTACT_PENETRATION &&
      partial.floorRelaunch.available &&
      partial.floorRelaunch.relaunchEventCount === 0 &&
      report.timing.totalExecutedSteps === partial.simulationStep &&
      Math.abs(report.timing.totalExecutedSimulationMs - partial.simulationTime * 1_000) <=
        toleranceMs
    if (!partialSafetyValid) {
      failure(
        failures,
        execution,
        'overload-partial-safety',
        'overload 前的 partial diagnostics 不安全或不守恒',
      )
    }
  }
  const ownFailures = failures.slice(start)
  return {
    cohort: 'watch-overload',
    seed: execution.seed,
    cadence: 'sustained100ms',
    scheduler: 'exact-cap4',
    passed: ownFailures.length === 0,
    run: compactRun(record),
    failureCodes: ownFailures.map(({ code }) => code),
  }
}

function summarizeCohort(
  cohort: CadenceComparisonCohort,
  comparisons: readonly CadenceComparisonObservation[],
  overloadChecks: readonly CadenceOverloadObservation[],
): CadenceCohortSummary {
  const entries =
    cohort === 'watch-overload'
      ? overloadChecks
      : comparisons.filter((entry) => entry.cohort === cohort)
  const failureSeeds = [...new Set(entries.filter(({ passed }) => !passed).map(({ seed }) => seed))]
  return {
    seedCount: new Set(entries.map(({ seed }) => seed)).size,
    comparisonCount: entries.length,
    passedCount: entries.filter(({ passed }) => passed).length,
    failedCount: entries.filter(({ passed }) => !passed).length,
    failureSeeds,
    candidateGroups:
      cohort === 'watch-overload' ? [] : candidateGroups(entries as CadenceComparisonObservation[]),
  }
}

/** 串行执行以避免共享 PRNG reseed 并发污染，并且每个 seed 的 reference 只保留到该 seed 完成。 */
export function executeCadenceComparison(
  options: ExecuteCadenceComparisonOptions,
): CadenceComparisonCoreReport {
  const runner = options.runCadenceRoll ?? runCadenceRoll
  const failures: CadenceComparisonFailure[] = []
  const comparisons: CadenceComparisonObservation[] = []
  const overloadChecks: CadenceOverloadObservation[] = []
  let actualRunCount = 0
  let currentSeed: number | null = null
  let reference: RunRecord | null = null
  let referenceValidForSeed = false

  for (const execution of options.plan.executions) {
    if (execution.seed !== currentSeed) {
      currentSeed = execution.seed
      reference = null
      referenceValidForSeed = false
    }
    let report: CadenceRollReport | null = null
    let error: string | null = null
    try {
      report = runner({
        seed: execution.seed,
        cadence: execution.cadence,
        scheduler: execution.scheduler,
      })
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    actualRunCount++
    options.onProgress?.(actualRunCount, options.plan.expectedRunCount, execution)
    const record = { execution, report, error }

    if (execution.role === 'reference') {
      reference = record
      const referenceFailureStart = failures.length
      const referenceShapeValid = validateNormalRun(record, failures)
      referenceValidForSeed = referenceShapeValid && failures.length === referenceFailureStart
      continue
    }
    if (execution.role === 'overload') {
      overloadChecks.push(validateOverloadRun(record, failures))
      continue
    }

    const comparisonStart = failures.length
    const candidateShapeValid = validateNormalRun(record, failures)
    const referenceValid = Boolean(reference && referenceValidForSeed)
    if (!reference) {
      failure(failures, execution, 'reference-run-error', 'candidate 缺少同 seed reference')
    } else if (!referenceValid) {
      failure(
        failures,
        execution,
        'reference-run-error',
        '同 seed reference 未通过正常 cadence 门禁',
      )
    }

    const candidateReport = candidateShapeValid ? record.report : null
    const referenceReport = reference?.report?.outcome === 'settled' ? reference.report : null
    const comparable = candidateReport !== null && referenceReport !== null
    const initialStateEqual = Boolean(
      comparable && exactDeepEqual(candidateReport.initialState, referenceReport.initialState),
    )
    const finalStateEqual = Boolean(
      comparable &&
      exactDeepEqual(candidateReport.roll.finalState, referenceReport.roll.finalState),
    )
    const rollResultEqual = Boolean(
      comparable && exactDeepEqual(candidateReport.roll, referenceReport.roll),
    )
    const judgeResultEqual = Boolean(
      comparable &&
      validFaces(candidateReport.roll) &&
      validFaces(referenceReport.roll) &&
      exactDeepEqual(
        judge(candidateReport.roll.finalFaces.map(({ value }) => value)),
        judge(referenceReport.roll.finalFaces.map(({ value }) => value)),
      ),
    )
    if (comparable) {
      if (!initialStateEqual)
        failure(failures, execution, 'initial-state-diff', '初始刚体状态与 reference 不一致')
      if (!finalStateEqual)
        failure(failures, execution, 'final-state-diff', '终态刚体状态与 reference 不一致')
      if (!rollResultEqual)
        failure(failures, execution, 'roll-result-diff', 'RollRunResult 与 reference 不一致')
      if (!judgeResultEqual)
        failure(failures, execution, 'judge-diff', 'JudgeResult 与 reference 不一致')
    }

    const ownFailures = failures.slice(comparisonStart)
    comparisons.push({
      cohort: execution.cohort as 'watch-normal' | 'batch-normal',
      seed: execution.seed,
      cadence: execution.cadence,
      scheduler: execution.scheduler as 'exact-cap6' | 'exact-cap4',
      passed: ownFailures.length === 0,
      reference: reference
        ? compactRun(reference)
        : compactRun({ ...record, report: null, error: 'missing reference' }),
      candidate: compactRun(record),
      equal: {
        initialState: initialStateEqual,
        finalState: finalStateEqual,
        rollResult: rollResultEqual,
        judgeResult: judgeResultEqual,
      },
      failureCodes: ownFailures.map(({ code }) => code),
    })
  }

  if (actualRunCount !== options.plan.expectedRunCount) {
    failures.push({
      code: 'execution-count-mismatch',
      cohort: 'global',
      seed: null,
      cadence: null,
      scheduler: null,
      role: 'global',
      expected: options.plan.expectedRunCount,
      actual: actualRunCount,
      message: '实际 cadence run 数与 versioned plan 不一致',
    })
  }

  const cohorts = {
    'watch-normal': summarizeCohort('watch-normal', comparisons, overloadChecks),
    'batch-normal': summarizeCohort('batch-normal', comparisons, overloadChecks),
    'watch-overload': summarizeCohort('watch-overload', comparisons, overloadChecks),
  }
  const failureSeeds = [
    ...new Set(failures.flatMap(({ seed }) => (seed === null ? [] : [seed]))),
  ].sort((left, right) => left - right)
  return {
    schemaVersion: CADENCE_COMPARISON_SCHEMA_VERSION,
    plan: options.plan,
    cohorts,
    summary: {
      passed: failures.length === 0,
      expectedRunCount: options.plan.expectedRunCount,
      actualRunCount,
      comparisonCount: comparisons.length,
      overloadCheckCount: overloadChecks.length,
      failureCount: failures.length,
    },
    comparisons,
    overloadChecks,
    failures,
    failureSeeds,
  }
}
