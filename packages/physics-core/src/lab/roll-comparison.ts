import { judge } from '@dice/game-domain'
import {
  PHYSICS_VARIANTS,
  getPhysicsVariant,
  type PhysicsVariant,
  type PhysicsVariantId,
} from '@dice/physics-core/config/physics-variants'
import { SETTLE } from '@dice/physics-core/config/settle'
import type { RollRunOptions, RollRunResult } from '@dice/physics-core'

export const PHYSICS_AB_SCHEMA_VERSION = 4

export interface PhysicsAbBudgets {
  candidateFallbackRate: number
  absoluteMaxContactPenetration: number
  maxContactPenetrationRegression: number
  p95SettleSecondsRegression: number
  p99SettleSecondsRegression: number
}

export const DEFAULT_PHYSICS_AB_BUDGETS: Readonly<PhysicsAbBudgets> = Object.freeze({
  candidateFallbackRate: 0.05,
  absoluteMaxContactPenetration: 0.1,
  maxContactPenetrationRegression: 0.002,
  p95SettleSecondsRegression: 0.5,
  p99SettleSecondsRegression: 0.75,
})

/** 历史问题和常规样本；默认 200 个总样本会先完整包含这些 watch seeds。 */
export const DEFAULT_PHYSICS_AB_WATCH_SEEDS = Object.freeze([
  1, 13, 42, 5555, 7777, 12345, 65000, 65535, 67000, 72000, 99999, 208000, 212000, 314159, 1673000,
  2718281, 1776219009201, 1776310976115, 1776311021115,
])

export interface PhysicsAbCliOptions {
  baseline: PhysicsVariantId
  candidate: PhysicsVariantId
  /** watch seeds 与生成 seeds 合计后的目标总数。 */
  seeds: number
  baseSeed: number
  watchSeeds: readonly number[]
  help: boolean
}

export const DEFAULT_PHYSICS_AB_OPTIONS: Readonly<PhysicsAbCliOptions> = Object.freeze({
  baseline: 'historical',
  candidate: 'current',
  seeds: 200,
  baseSeed: 50000,
  watchSeeds: DEFAULT_PHYSICS_AB_WATCH_SEEDS,
  help: false,
})

function parseSafeInteger(name: string, value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`--${name} 必须是安全整数，收到 ${value}`)
  }
  return parsed
}

function parsePositiveInteger(name: string, value: string): number {
  const parsed = parseSafeInteger(name, value)
  if (parsed <= 0) throw new RangeError(`--${name} 必须大于 0，收到 ${value}`)
  return parsed
}

function parseWatchSeeds(value: string): number[] {
  if (value === '' || value === 'none') return []

  const seeds = value.split(',').map((part) => {
    if (part.trim() === '') throw new RangeError('--watch-seeds 不能包含空值')
    return parseSafeInteger('watch-seeds', part)
  })
  return [...new Set(seeds)]
}

/** 纯参数解析；CLI 入口只负责打印和设置退出码。 */
export function parsePhysicsAbArgs(args: readonly string[]): PhysicsAbCliOptions {
  const values = new Map<string, string>()
  let help = false

  for (const arg of args) {
    if (arg === '--help') {
      help = true
      continue
    }

    const match = arg.match(/^--([\w-]+)=(.*)$/)
    if (!match) throw new Error(`不支持的参数格式：${arg}`)
    const [, key, value] = match
    if (!['baseline', 'candidate', 'seeds', 'base-seed', 'watch-seeds'].includes(key)) {
      throw new Error(`不支持的参数：--${key}`)
    }
    if (values.has(key)) throw new Error(`参数重复：--${key}`)
    values.set(key, value)
  }

  const baseline = getPhysicsVariant(
    values.get('baseline') ?? DEFAULT_PHYSICS_AB_OPTIONS.baseline,
  ).id
  const candidate = getPhysicsVariant(
    values.get('candidate') ?? DEFAULT_PHYSICS_AB_OPTIONS.candidate,
  ).id
  if (baseline === candidate) {
    throw new RangeError('baseline 与 candidate 必须使用不同的命名 preset')
  }

  return {
    baseline,
    candidate,
    seeds: parsePositiveInteger(
      'seeds',
      values.get('seeds') ?? String(DEFAULT_PHYSICS_AB_OPTIONS.seeds),
    ),
    baseSeed: parseSafeInteger(
      'base-seed',
      values.get('base-seed') ?? String(DEFAULT_PHYSICS_AB_OPTIONS.baseSeed),
    ),
    watchSeeds: values.has('watch-seeds')
      ? parseWatchSeeds(values.get('watch-seeds')!)
      : [...DEFAULT_PHYSICS_AB_WATCH_SEEDS],
    help,
  }
}

/** 构造固定总数的唯一 seed 集；watch seeds 永远优先且不会被批量样本挤掉。 */
export function buildPhysicsAbSeedSet(options: PhysicsAbCliOptions): number[] {
  const watchSeeds = [...new Set(options.watchSeeds)]
  for (const seed of watchSeeds) {
    if (!Number.isSafeInteger(seed)) throw new RangeError(`watch seed 不是安全整数：${seed}`)
  }
  if (watchSeeds.length > options.seeds) {
    throw new RangeError(`--seeds=${options.seeds} 小于唯一 watch seeds 数量 ${watchSeeds.length}`)
  }

  const result = [...watchSeeds]
  const seen = new Set(result)
  let index = 0
  while (result.length < options.seeds) {
    const seed = options.baseSeed + index * 1000
    if (!Number.isSafeInteger(seed)) throw new RangeError(`生成的 seed 超出安全整数范围：${seed}`)
    if (!seen.has(seed)) {
      seen.add(seed)
      result.push(seed)
    }
    index++
  }
  return result
}

export type PhysicsAbRole = 'baseline' | 'candidate'
export type PhysicsAbExecutionOrder = 'baseline-candidate' | 'candidate-baseline'

export interface PhysicsAbExecution {
  sequence: number
  seedIndex: number
  seed: number
  role: PhysicsAbRole
  variant: Readonly<PhysicsVariant>
}

/** 每个 seed 只跑一次 A 与一次 B；相邻 seed 采用 A/B、B/A 交替顺序。 */
export function createPhysicsAbExecutionPlan(
  seeds: readonly number[],
  baseline: Readonly<PhysicsVariant>,
  candidate: Readonly<PhysicsVariant>,
): PhysicsAbExecution[] {
  const executions: PhysicsAbExecution[] = []
  for (let seedIndex = 0; seedIndex < seeds.length; seedIndex++) {
    const seed = seeds[seedIndex]
    if (!Number.isSafeInteger(seed)) throw new RangeError(`seed 不是安全整数：${seed}`)
    const order: PhysicsAbRole[] =
      seedIndex % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']
    for (const role of order) {
      executions.push({
        sequence: executions.length,
        seedIndex,
        seed,
        role,
        variant: role === 'baseline' ? baseline : candidate,
      })
    }
  }
  return executions
}

export interface PhysicsAbPair {
  seed: number
  executionOrder: PhysicsAbExecutionOrder
  baseline: RollRunResult
  candidate: RollRunResult
  /** 非自然结算时，从同一初始条件继续到自然 sleep 或独立预算的反事实参考。 */
  baselineContinuation?: RollRunResult
  candidateContinuation?: RollRunResult
}

export type RollRunner = (options: RollRunOptions) => RollRunResult

export interface ExecutePhysicsAbOptions {
  seeds: readonly number[]
  /** 历史回归 seed；仍做硬安全/真实性检查，但不进入分布预算。 */
  watchSeeds?: readonly number[]
  baseline: Readonly<PhysicsVariant>
  candidate: Readonly<PhysicsVariant>
  runRoll: RollRunner
  budgets?: Readonly<PhysicsAbBudgets>
}

export interface RollSummary {
  rolls: number
  settleReasons: Record<string, number>
  fallbackCount: number
  fallbackRate: number
  assistedRollCount: number
  assistInterventionCount: number
  ambiguousDiceCount: number
  ambiguousDiceRate: number
  conservativeBoundaryCrossingSeeds: number
  faceChangedDuringStableWindowSeeds: number
  floorRelaunchUnavailableCount: number
  floorRelaunchEventCount: number
  floorInitialContactObservedDiceCount: number
  floorArmedDiceCount: number
  maxFloorOnlySecondaryClearance: number
  maxFloorOnlySecondaryOrderedWorldYRise: number
  maxPreExternalSecondaryClearance: number
  maxPreExternalSecondaryOrderedWorldYRise: number
  maxRadius: number
  maxContactPenetration: number
  settleSeconds: { p50: number; p95: number; p99: number; max: number }
  settleFrames: { p50: number; p95: number; p99: number; max: number }
  faceCounts: Record<string, number>
  /** 按稳定骰子索引记录每个面值，供检查位置相关偏差；仅观测，不设硬门槛。 */
  faceCountsByDie: Array<Record<string, number>>
  /** 六骰总点数分布；仅观测，不设硬门槛。 */
  sumCounts: Record<string, number>
  prizeCounts: Record<string, number>
}

export interface PhysicsAbSeedDiff {
  seed: number
  cohort: PhysicsAbCohort
  executionOrder: PhysicsAbExecutionOrder
  placement: { baseline: string; candidate: string }
  settleReason: { baseline: string; candidate: string }
  settleSeconds: { baseline: number; candidate: number; delta: number }
  settleFrames: { baseline: number; candidate: number; delta: number }
  assistInterventions: { baseline: number; candidate: number }
  maxContactPenetration: { baseline: number; candidate: number; delta: number }
  faces: { baseline: number[]; candidate: number[]; changedDice: number }
  prize: { baseline: string | null; candidate: string | null }
  safetyFailures: { baseline: string[]; candidate: string[] }
  continuation: {
    baseline: PhysicsAbContinuationDiff | null
    candidate: PhysicsAbContinuationDiff | null
  }
}

export interface PhysicsAbContinuationDiff {
  settleReason: string
  exhausted: boolean
  faceDiff: boolean
  tiltDiff: boolean
  /** 名称沿用报表口径，实际比较完整 JudgeResult，不只比较 prize 字段。 */
  prizeDiff: boolean
  safetyFailures: string[]
}

export interface PhysicsAbSeedMetric {
  count: number
  seeds: number[]
}

export interface PhysicsAbContinuationSummary {
  /** 实际执行 continuation 的非自然结算样本。 */
  count: number
  seeds: number[]
  /** 非自然结算却缺少 continuation；executePhysicsAb 正常路径不应出现。 */
  missing: PhysicsAbSeedMetric
  exhausted: PhysicsAbSeedMetric
  faceDiff: PhysicsAbSeedMetric
  tiltDiff: PhysicsAbSeedMetric
  /** 比较完整 JudgeResult，字段名保持简洁的报表口径。 */
  prizeDiff: PhysicsAbSeedMetric
  safety: PhysicsAbSeedMetric & {
    nanSeeds: number[]
    wallCrossingSeeds: number[]
    escapeGuardSeeds: number[]
    floorRelaunchUnavailableSeeds: number[]
    floorRelaunchSeeds: number[]
  }
}

export interface PhysicsAbGateFailure {
  code: string
  message: string
  seeds: number[]
}

export type PhysicsAbCohort = 'watch' | 'batch'

export interface PhysicsAbCohortSummary {
  sampleCount: number
  seeds: number[]
  /** watch 可以为空；batch 在 evaluate/CLI 中必须非空。 */
  baseline: RollSummary | null
  candidate: RollSummary | null
}

export interface PhysicsAbSummary {
  passed: boolean
  baseline: RollSummary
  candidate: RollSummary
  delta: {
    fallbackRate: number
    maxContactPenetration: number
    p95SettleSeconds: number
    p99SettleSeconds: number
  }
  /** 分布预算只读取 batch；总体 baseline/candidate 仍保留全部样本。 */
  budgetCohort: 'batch'
  cohorts: {
    watch: PhysicsAbCohortSummary
    batch: PhysicsAbCohortSummary
  }
  penetrationLimit: number
  continuations: {
    baseline: PhysicsAbContinuationSummary
    candidate: PhysicsAbContinuationSummary
  }
  failures: PhysicsAbGateFailure[]
}

export interface PhysicsAbReport {
  schemaVersion: typeof PHYSICS_AB_SCHEMA_VERSION
  baselineVariant: Readonly<PhysicsVariant>
  candidateVariant: Readonly<PhysicsVariant>
  budgets: Readonly<PhysicsAbBudgets>
  summary: PhysicsAbSummary
  diffs: PhysicsAbSeedDiff[]
  failureSeeds: number[]
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) throw new RangeError('percentile 至少需要一个样本')
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function validFaceValues(result: RollRunResult): number[] | null {
  const values = result.finalFaces.map(({ value }) => value)
  return values.length === 6 &&
    values.every((value) => Number.isInteger(value) && value >= 1 && value <= 6)
    ? values
    : null
}

function sameValues<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function tiltClassifications(result: RollRunResult): boolean[] {
  return result.finalFaces.map(({ confidence }) => confidence < SETTLE.tiltThreshold)
}

function sameJudgeResult(left: RollRunResult, right: RollRunResult): boolean {
  const leftValues = validFaceValues(left)
  const rightValues = validFaceValues(right)
  if (!leftValues || !rightValues) return false

  const leftJudge = judge(leftValues)
  const rightJudge = judge(rightValues)
  return (
    leftJudge.prize === rightJudge.prize &&
    leftJudge.priority === rightJudge.priority &&
    leftJudge.carryScore === rightJudge.carryScore &&
    leftJudge.description === rightJudge.description &&
    sameValues(leftJudge.matchedDice, rightJudge.matchedDice) &&
    sameValues(leftJudge.remainDice, rightJudge.remainDice)
  )
}

/** continuation 只门禁轨迹安全事实；预算耗尽单独统计，不伪装成安全失败。 */
function continuationSafetyFailureCodes(result: RollRunResult): string[] {
  const failures: string[] = []
  if (result.nanDetected) failures.push('nan')
  if (result.wallCenterCrossings > 0) failures.push('wall-crossing')
  if (result.escapeGuardInterventionCount > 0) failures.push('escape-guard')
  if (!result.floorRelaunch.available) failures.push('floor-relaunch-unavailable')
  if (result.floorRelaunch.relaunchEventCount > 0) failures.push('floor-relaunch')
  return failures
}

/** 比较运行时结算与同初始条件自然延续结果，供 A/B 和统一验收复用。 */
export function compareRollContinuation(
  result: RollRunResult,
  continuation: RollRunResult,
): PhysicsAbContinuationDiff {
  return {
    settleReason: continuation.settleReason,
    exhausted: continuation.settleReason === 'continuation-budget-exhausted',
    faceDiff: !sameValues(
      result.finalFaces.map(({ value }) => value),
      continuation.finalFaces.map(({ value }) => value),
    ),
    tiltDiff: !sameValues(tiltClassifications(result), tiltClassifications(continuation)),
    prizeDiff: !sameJudgeResult(result, continuation),
    safetyFailures: continuationSafetyFailureCodes(continuation),
  }
}

function continuationFor(pair: PhysicsAbPair, role: PhysicsAbRole): RollRunResult | undefined {
  return role === 'baseline' ? pair.baselineContinuation : pair.candidateContinuation
}

function resultFor(pair: PhysicsAbPair, role: PhysicsAbRole): RollRunResult {
  return role === 'baseline' ? pair.baseline : pair.candidate
}

function seedMetric(seeds: readonly number[]): PhysicsAbSeedMetric {
  const uniqueSeeds = [...new Set(seeds)].sort((a, b) => a - b)
  return { count: uniqueSeeds.length, seeds: uniqueSeeds }
}

function summarizeContinuations(
  pairs: readonly PhysicsAbPair[],
  role: PhysicsAbRole,
): PhysicsAbContinuationSummary {
  const required = pairs.filter((pair) => resultFor(pair, role).settleReason !== 'natural-sleep')
  const available = required.filter((pair) => continuationFor(pair, role) !== undefined)
  const comparisons = available.map((pair) => ({
    seed: pair.seed,
    comparison: compareRollContinuation(resultFor(pair, role), continuationFor(pair, role)!),
  }))
  const safetyEntries = comparisons.filter(({ comparison }) => comparison.safetyFailures.length > 0)

  return {
    count: available.length,
    seeds: available.map(({ seed }) => seed).sort((a, b) => a - b),
    missing: seedMetric(
      required.filter((pair) => continuationFor(pair, role) === undefined).map(({ seed }) => seed),
    ),
    exhausted: seedMetric(
      comparisons.filter(({ comparison }) => comparison.exhausted).map(({ seed }) => seed),
    ),
    faceDiff: seedMetric(
      comparisons.filter(({ comparison }) => comparison.faceDiff).map(({ seed }) => seed),
    ),
    tiltDiff: seedMetric(
      comparisons.filter(({ comparison }) => comparison.tiltDiff).map(({ seed }) => seed),
    ),
    prizeDiff: seedMetric(
      comparisons.filter(({ comparison }) => comparison.prizeDiff).map(({ seed }) => seed),
    ),
    safety: {
      ...seedMetric(safetyEntries.map(({ seed }) => seed)),
      nanSeeds: safetyEntries
        .filter(({ comparison }) => comparison.safetyFailures.includes('nan'))
        .map(({ seed }) => seed),
      wallCrossingSeeds: safetyEntries
        .filter(({ comparison }) => comparison.safetyFailures.includes('wall-crossing'))
        .map(({ seed }) => seed),
      escapeGuardSeeds: safetyEntries
        .filter(({ comparison }) => comparison.safetyFailures.includes('escape-guard'))
        .map(({ seed }) => seed),
      floorRelaunchUnavailableSeeds: safetyEntries
        .filter(({ comparison }) =>
          comparison.safetyFailures.includes('floor-relaunch-unavailable'),
        )
        .map(({ seed }) => seed),
      floorRelaunchSeeds: safetyEntries
        .filter(({ comparison }) => comparison.safetyFailures.includes('floor-relaunch'))
        .map(({ seed }) => seed),
    },
  }
}

function safetyFailureCodes(result: RollRunResult): string[] {
  const failures: string[] = []
  if (result.nanDetected) failures.push('nan')
  if (result.wallCenterCrossings > 0) failures.push('wall-crossing')
  if (result.escapeGuardInterventionCount > 0) failures.push('escape-guard')
  if (!result.floorRelaunch.available) failures.push('floor-relaunch-unavailable')
  if (result.floorRelaunch.relaunchEventCount > 0) failures.push('floor-relaunch')
  if (result.settleReason === 'timeout') failures.push('timeout')
  if (result.settleReason === 'frame-budget-exhausted' || result.settleFrame <= 0) {
    failures.push('frame-budget')
  }
  if (!validFaceValues(result)) failures.push('invalid-final-faces')
  return failures
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1
}

function emptyFaceCounts(): Record<string, number> {
  return Object.fromEntries(Array.from({ length: 6 }, (_, index) => [String(index + 1), 0]))
}

export function summarizeRollResults(results: readonly RollRunResult[]): RollSummary {
  if (results.length === 0) throw new RangeError('A/B 汇总至少需要一个结果')

  const settleReasons: Record<string, number> = {}
  const faceCounts = emptyFaceCounts()
  const faceCountsByDie = Array.from({ length: 6 }, () => emptyFaceCounts())
  const sumCounts: Record<string, number> = Object.fromEntries(
    Array.from({ length: 31 }, (_, index) => [String(index + 6), 0]),
  )
  const prizeCounts: Record<string, number> = {}
  let fallbackCount = 0
  let assistedRollCount = 0
  let assistInterventionCount = 0
  let ambiguousDiceCount = 0
  let conservativeBoundaryCrossingSeeds = 0
  let faceChangedDuringStableWindowSeeds = 0

  for (const result of results) {
    increment(settleReasons, result.settleReason)
    if (result.throwDiagnostics.placementPath === 'fallback') fallbackCount++
    if (result.assistInterventionCount > 0 || result.settleReason === 'cluster-assist') {
      assistedRollCount++
    }
    assistInterventionCount += result.assistInterventionCount
    ambiguousDiceCount += result.ambiguousDiceCount
    if (result.conservativeBoundaryCrossings > 0) conservativeBoundaryCrossingSeeds++
    if (result.faceChangedDuringStableWindow) faceChangedDuringStableWindowSeeds++

    const values = validFaceValues(result)
    if (!values) continue
    for (let index = 0; index < values.length; index++) {
      increment(faceCounts, String(values[index]))
      increment(faceCountsByDie[index], String(values[index]))
    }
    increment(sumCounts, String(values.reduce((sum, value) => sum + value, 0)))
    increment(prizeCounts, judge(values).prize)
  }

  const settleTimes = results.map(({ settleTime }) => settleTime)
  const settleFrames = results.map(({ settleFrame }) => settleFrame)
  return {
    rolls: results.length,
    settleReasons,
    fallbackCount,
    fallbackRate: fallbackCount / results.length,
    assistedRollCount,
    assistInterventionCount,
    ambiguousDiceCount,
    ambiguousDiceRate: ambiguousDiceCount / (results.length * 6),
    conservativeBoundaryCrossingSeeds,
    faceChangedDuringStableWindowSeeds,
    floorRelaunchUnavailableCount: results.filter(({ floorRelaunch }) => !floorRelaunch.available)
      .length,
    floorRelaunchEventCount: results.reduce(
      (sum, { floorRelaunch }) => sum + floorRelaunch.relaunchEventCount,
      0,
    ),
    floorInitialContactObservedDiceCount: results.reduce(
      (sum, { floorRelaunch }) => sum + floorRelaunch.initialContactObservedDiceCount,
      0,
    ),
    floorArmedDiceCount: results.reduce(
      (sum, { floorRelaunch }) => sum + floorRelaunch.armedDiceCount,
      0,
    ),
    maxFloorOnlySecondaryClearance: Math.max(
      ...results.map(({ floorRelaunch }) => floorRelaunch.maxFloorOnlySecondaryClearance),
    ),
    maxFloorOnlySecondaryOrderedWorldYRise: Math.max(
      ...results.map(({ floorRelaunch }) => floorRelaunch.maxFloorOnlySecondaryOrderedWorldYRise),
    ),
    maxPreExternalSecondaryClearance: Math.max(
      ...results.map(({ floorRelaunch }) => floorRelaunch.maxPreExternalSecondaryClearance),
    ),
    maxPreExternalSecondaryOrderedWorldYRise: Math.max(
      ...results.map(({ floorRelaunch }) => floorRelaunch.maxPreExternalSecondaryOrderedWorldYRise),
    ),
    maxRadius: Math.max(...results.map(({ maxRadius }) => maxRadius)),
    maxContactPenetration: Math.max(
      ...results.map(({ maxContactPenetration }) => maxContactPenetration),
    ),
    settleSeconds: {
      p50: percentile(settleTimes, 0.5),
      p95: percentile(settleTimes, 0.95),
      p99: percentile(settleTimes, 0.99),
      max: Math.max(...settleTimes),
    },
    settleFrames: {
      p50: percentile(settleFrames, 0.5),
      p95: percentile(settleFrames, 0.95),
      p99: percentile(settleFrames, 0.99),
      max: Math.max(...settleFrames),
    },
    faceCounts,
    faceCountsByDie,
    sumCounts,
    prizeCounts,
  }
}

function prizeFor(result: RollRunResult): string | null {
  const values = validFaceValues(result)
  return values ? judge(values).prize : null
}

function createSeedDiff(pair: PhysicsAbPair, watchSeedSet: ReadonlySet<number>): PhysicsAbSeedDiff {
  const baselineFaces = pair.baseline.finalFaces.map(({ value }) => value)
  const candidateFaces = pair.candidate.finalFaces.map(({ value }) => value)
  return {
    seed: pair.seed,
    cohort: watchSeedSet.has(pair.seed) ? 'watch' : 'batch',
    executionOrder: pair.executionOrder,
    placement: {
      baseline: pair.baseline.throwDiagnostics.placementPath,
      candidate: pair.candidate.throwDiagnostics.placementPath,
    },
    settleReason: {
      baseline: pair.baseline.settleReason,
      candidate: pair.candidate.settleReason,
    },
    settleSeconds: {
      baseline: pair.baseline.settleTime,
      candidate: pair.candidate.settleTime,
      delta: pair.candidate.settleTime - pair.baseline.settleTime,
    },
    settleFrames: {
      baseline: pair.baseline.settleFrame,
      candidate: pair.candidate.settleFrame,
      delta: pair.candidate.settleFrame - pair.baseline.settleFrame,
    },
    assistInterventions: {
      baseline: pair.baseline.assistInterventionCount,
      candidate: pair.candidate.assistInterventionCount,
    },
    maxContactPenetration: {
      baseline: pair.baseline.maxContactPenetration,
      candidate: pair.candidate.maxContactPenetration,
      delta: pair.candidate.maxContactPenetration - pair.baseline.maxContactPenetration,
    },
    faces: {
      baseline: baselineFaces,
      candidate: candidateFaces,
      changedDice: baselineFaces.filter((value, index) => value !== candidateFaces[index]).length,
    },
    prize: { baseline: prizeFor(pair.baseline), candidate: prizeFor(pair.candidate) },
    safetyFailures: {
      baseline: safetyFailureCodes(pair.baseline),
      candidate: safetyFailureCodes(pair.candidate),
    },
    continuation: {
      baseline: pair.baselineContinuation
        ? compareRollContinuation(pair.baseline, pair.baselineContinuation)
        : null,
      candidate: pair.candidateContinuation
        ? compareRollContinuation(pair.candidate, pair.candidateContinuation)
        : null,
    },
  }
}

function summarizeCohort(pairs: readonly PhysicsAbPair[]): PhysicsAbCohortSummary {
  return {
    sampleCount: pairs.length,
    seeds: pairs.map(({ seed }) => seed),
    baseline: pairs.length > 0 ? summarizeRollResults(pairs.map(({ baseline }) => baseline)) : null,
    candidate:
      pairs.length > 0 ? summarizeRollResults(pairs.map(({ candidate }) => candidate)) : null,
  }
}

function resolveWatchSeedSet(
  seeds: readonly number[],
  watchSeeds: readonly number[],
): ReadonlySet<number> {
  const seedSet = new Set(seeds)
  if (seedSet.size !== seeds.length) throw new RangeError('A/B seed 集不能包含重复值')

  const watchSeedSet = new Set<number>()
  for (const seed of watchSeeds) {
    if (!Number.isSafeInteger(seed)) throw new RangeError(`watch seed 不是安全整数：${seed}`)
    if (!seedSet.has(seed)) throw new RangeError(`watch seed ${seed} 不在本次 A/B seed 集中`)
    watchSeedSet.add(seed)
  }
  if (seedSet.size - watchSeedSet.size === 0) {
    throw new RangeError('physics A/B 分布预算至少需要 1 个非 watch 的 batch seed')
  }
  return watchSeedSet
}

function splitPhysicsAbCohorts(
  pairs: readonly PhysicsAbPair[],
  watchSeeds: readonly number[],
): {
  watchSeedSet: ReadonlySet<number>
  watchPairs: PhysicsAbPair[]
  batchPairs: PhysicsAbPair[]
} {
  const watchSeedSet = resolveWatchSeedSet(
    pairs.map(({ seed }) => seed),
    watchSeeds,
  )

  const watchPairs = pairs.filter(({ seed }) => watchSeedSet.has(seed))
  const batchPairs = pairs.filter(({ seed }) => !watchSeedSet.has(seed))
  return { watchSeedSet, watchPairs, batchPairs }
}

function tailSeeds(pairs: readonly PhysicsAbPair[], fraction: number): number[] {
  const threshold = percentile(
    pairs.map(({ candidate }) => candidate.settleTime),
    fraction,
  )
  return pairs.filter(({ candidate }) => candidate.settleTime >= threshold).map(({ seed }) => seed)
}

function settleRegressionSeeds(
  pairs: readonly PhysicsAbPair[],
  limit: number,
  fraction: number,
): number[] {
  const pairedRegressions = pairs
    .filter(({ baseline, candidate }) => candidate.settleTime - baseline.settleTime > limit)
    .map(({ seed }) => seed)
  return pairedRegressions.length > 0 ? pairedRegressions : tailSeeds(pairs, fraction)
}

export function evaluatePhysicsAbPairs(
  pairs: readonly PhysicsAbPair[],
  baselineVariant: Readonly<PhysicsVariant>,
  candidateVariant: Readonly<PhysicsVariant>,
  budgets: Readonly<PhysicsAbBudgets> = DEFAULT_PHYSICS_AB_BUDGETS,
  watchSeeds: readonly number[] = [],
): PhysicsAbReport {
  if (pairs.length === 0) throw new RangeError('A/B 比较至少需要一个 seed pair')

  const { watchSeedSet, watchPairs, batchPairs } = splitPhysicsAbCohorts(pairs, watchSeeds)
  const baselineResults = pairs.map(({ baseline }) => baseline)
  const candidateResults = pairs.map(({ candidate }) => candidate)
  const baseline = summarizeRollResults(baselineResults)
  const candidate = summarizeRollResults(candidateResults)
  const cohorts = {
    watch: summarizeCohort(watchPairs),
    batch: summarizeCohort(batchPairs),
  }
  const batchBaseline = cohorts.batch.baseline!
  const batchCandidate = cohorts.batch.candidate!
  const continuations = {
    baseline: summarizeContinuations(pairs, 'baseline'),
    candidate: summarizeContinuations(pairs, 'candidate'),
  }
  const failures: PhysicsAbGateFailure[] = []

  for (const role of ['baseline', 'candidate'] as const) {
    const grouped = new Map<string, number[]>()
    for (const pair of pairs) {
      for (const code of safetyFailureCodes(pair[role])) {
        const seeds = grouped.get(code) ?? []
        seeds.push(pair.seed)
        grouped.set(code, seeds)
      }
    }
    for (const [code, seeds] of grouped) {
      failures.push({
        code: `${role}-${code}`,
        message: `${role} 出现安全失败 ${code}: ${seeds.length}/${pairs.length}`,
        seeds,
      })
    }
  }

  const candidateContinuationFailures: Array<{
    code: string
    label: string
    metric: PhysicsAbSeedMetric
  }> = [
    {
      code: 'candidate-continuation-missing',
      label: '缺少 natural continuation',
      metric: continuations.candidate.missing,
    },
    {
      code: 'candidate-continuation-face-diff',
      label: '逐骰 face 与 natural continuation 不一致',
      metric: continuations.candidate.faceDiff,
    },
    {
      code: 'candidate-continuation-tilt-diff',
      label: '逐骰 tilt 分类与 natural continuation 不一致',
      metric: continuations.candidate.tiltDiff,
    },
    {
      code: 'candidate-continuation-prize-diff',
      label: '完整 JudgeResult 与 natural continuation 不一致',
      metric: continuations.candidate.prizeDiff,
    },
    {
      code: 'candidate-continuation-nan',
      label: 'natural continuation 出现 NaN',
      metric: seedMetric(continuations.candidate.safety.nanSeeds),
    },
    {
      code: 'candidate-continuation-wall-crossing',
      label: 'natural continuation 越过物理挡墙',
      metric: seedMetric(continuations.candidate.safety.wallCrossingSeeds),
    },
    {
      code: 'candidate-continuation-escape-guard',
      label: 'natural continuation 触发逃逸保护',
      metric: seedMetric(continuations.candidate.safety.escapeGuardSeeds),
    },
    {
      code: 'candidate-continuation-floor-relaunch-unavailable',
      label: 'natural continuation 缺少碗底二次发射诊断',
      metric: seedMetric(continuations.candidate.safety.floorRelaunchUnavailableSeeds),
    },
    {
      code: 'candidate-continuation-floor-relaunch',
      label: 'natural continuation 出现碗底异常二次发射',
      metric: seedMetric(continuations.candidate.safety.floorRelaunchSeeds),
    },
  ]
  for (const { code, label, metric } of candidateContinuationFailures) {
    if (metric.count === 0) continue
    failures.push({
      code,
      message: `candidate ${label}: ${metric.count}/${pairs.length}`,
      seeds: metric.seeds,
    })
  }

  const candidateAssistSeeds = pairs
    .filter(
      ({ candidate: result }) =>
        result.assistInterventionCount > 0 || result.settleReason === 'cluster-assist',
    )
    .map(({ seed }) => seed)
  if (candidateAssistSeeds.length > 0) {
    failures.push({
      code: 'candidate-assist-not-zero',
      message: `candidate 人工 assist 必须为 0，实际 ${candidateAssistSeeds.length}/${pairs.length}`,
      seeds: candidateAssistSeeds,
    })
  }

  const candidateFallbackSeeds = batchPairs
    .filter(({ candidate: result }) => result.throwDiagnostics.placementPath === 'fallback')
    .map(({ seed }) => seed)
  if (batchCandidate.fallbackRate > budgets.candidateFallbackRate) {
    failures.push({
      code: 'candidate-fallback-rate',
      message: `candidate batch fallback rate ${batchCandidate.fallbackRate} > ${budgets.candidateFallbackRate}`,
      seeds: candidateFallbackSeeds,
    })
  }

  const penetrationLimit = Math.max(
    budgets.absoluteMaxContactPenetration,
    batchBaseline.maxContactPenetration + budgets.maxContactPenetrationRegression,
  )
  if (batchCandidate.maxContactPenetration > penetrationLimit) {
    failures.push({
      code: 'candidate-contact-penetration',
      message: `candidate batch max penetration ${batchCandidate.maxContactPenetration} > ${penetrationLimit}`,
      seeds: batchPairs
        .filter(({ candidate: result }) => result.maxContactPenetration > penetrationLimit)
        .map(({ seed }) => seed),
    })
  }

  const p95Delta = batchCandidate.settleSeconds.p95 - batchBaseline.settleSeconds.p95
  if (p95Delta > budgets.p95SettleSecondsRegression) {
    failures.push({
      code: 'candidate-p95-settle-regression',
      message: `candidate p95 settle delta ${p95Delta}s > ${budgets.p95SettleSecondsRegression}s`,
      seeds: settleRegressionSeeds(batchPairs, budgets.p95SettleSecondsRegression, 0.95),
    })
  }

  const p99Delta = batchCandidate.settleSeconds.p99 - batchBaseline.settleSeconds.p99
  if (p99Delta > budgets.p99SettleSecondsRegression) {
    failures.push({
      code: 'candidate-p99-settle-regression',
      message: `candidate p99 settle delta ${p99Delta}s > ${budgets.p99SettleSecondsRegression}s`,
      seeds: settleRegressionSeeds(batchPairs, budgets.p99SettleSecondsRegression, 0.99),
    })
  }

  const failureSeeds = [...new Set(failures.flatMap(({ seeds }) => seeds))].sort((a, b) => a - b)
  return {
    schemaVersion: PHYSICS_AB_SCHEMA_VERSION,
    baselineVariant,
    candidateVariant,
    budgets,
    summary: {
      passed: failures.length === 0,
      baseline,
      candidate,
      delta: {
        fallbackRate: batchCandidate.fallbackRate - batchBaseline.fallbackRate,
        maxContactPenetration:
          batchCandidate.maxContactPenetration - batchBaseline.maxContactPenetration,
        p95SettleSeconds: p95Delta,
        p99SettleSeconds: p99Delta,
      },
      budgetCohort: 'batch',
      cohorts,
      penetrationLimit,
      continuations,
      failures,
    },
    diffs: pairs.map((pair) => createSeedDiff(pair, watchSeedSet)),
    failureSeeds,
  }
}

export function executePhysicsAb(options: ExecutePhysicsAbOptions): PhysicsAbReport {
  if (options.seeds.length === 0) throw new RangeError('A/B 至少需要一个 seed')
  const watchSeeds = options.watchSeeds ?? []
  resolveWatchSeedSet(options.seeds, watchSeeds)

  const plan = createPhysicsAbExecutionPlan(options.seeds, options.baseline, options.candidate)
  const partialPairs = new Map<
    number,
    {
      baseline?: RollRunResult
      candidate?: RollRunResult
      baselineContinuation?: RollRunResult
      candidateContinuation?: RollRunResult
      executionOrder: PhysicsAbExecutionOrder
    }
  >()

  for (const execution of plan) {
    const current = partialPairs.get(execution.seed) ?? {
      executionOrder: execution.seedIndex % 2 === 0 ? 'baseline-candidate' : 'candidate-baseline',
    }
    current[execution.role] = options.runRoll({
      seed: execution.seed,
      throwPlacementAlgorithm: execution.variant.throwPlacementAlgorithm,
      contactClusterAssistEnabled: execution.variant.contactClusterAssistEnabled,
      poseStableWindowEnabled: execution.variant.poseStableWindowEnabled,
    })
    partialPairs.set(execution.seed, current)
  }

  // 先完成完整的 A/B、B/A 主样本，再按同一交替顺序运行必要的反事实参考。
  // continuation 从相同 seed/投掷算法重新模拟，只关闭 assist 并等待自然 sleep。
  for (const execution of plan) {
    const current = partialPairs.get(execution.seed)
    const result = current?.[execution.role]
    if (!current || !result) throw new Error(`seed ${execution.seed} 缺少 ${execution.role} 结果`)
    if (result.settleReason === 'natural-sleep') continue

    const continuation = options.runRoll({
      seed: execution.seed,
      throwPlacementAlgorithm: execution.variant.throwPlacementAlgorithm,
      contactClusterAssistEnabled: false,
      poseStableWindowEnabled: false,
      settlementPolicy: 'natural-continuation',
      maxFrames: 1200,
    })
    if (execution.role === 'baseline') current.baselineContinuation = continuation
    else current.candidateContinuation = continuation
  }

  const pairs = options.seeds.map((seed): PhysicsAbPair => {
    const pair = partialPairs.get(seed)
    if (!pair?.baseline || !pair.candidate) {
      throw new Error(`seed ${seed} 缺少 baseline 或 candidate 结果`)
    }
    return {
      seed,
      executionOrder: pair.executionOrder,
      baseline: pair.baseline,
      candidate: pair.candidate,
      baselineContinuation: pair.baselineContinuation,
      candidateContinuation: pair.candidateContinuation,
    }
  })

  return evaluatePhysicsAbPairs(
    pairs,
    options.baseline,
    options.candidate,
    options.budgets,
    watchSeeds,
  )
}

export function resolvePhysicsAbVariants(options: PhysicsAbCliOptions): {
  baseline: Readonly<PhysicsVariant>
  candidate: Readonly<PhysicsVariant>
} {
  return {
    baseline: PHYSICS_VARIANTS[options.baseline],
    candidate: PHYSICS_VARIANTS[options.candidate],
  }
}
