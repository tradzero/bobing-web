import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  ROLL_DIAGNOSTICS_SCHEMA_VERSION,
  runRoll,
  serializeRollResult,
  type RollRunResult,
} from '../src/physics/roll-runner.ts'
import { THROW } from '../src/config/throw.ts'
import { PHYSICS } from '../src/config/physics.ts'
import { SETTLE } from '../src/config/settle.ts'
import {
  HF_GRID_SIZE,
  WALL_COUNT,
  WALL_HEIGHT,
  WALL_RADIUS,
  WALL_THICKNESS,
} from '../src/physics/bowl-body.ts'
import { THROW_ALGORITHM_VERSION, THROW_RANDOM_PLAN_VERSION } from '../src/dice/throw.ts'
import { SETTLE_ALGORITHM_VERSION } from '../src/dice/settle.ts'
import { ESCAPE_GUARD_VERSION } from '../src/physics/escape-guard.ts'
import { compareRollContinuation, summarizeRollResults } from '../src/physics/roll-comparison.ts'
import { PHYSICS_VARIANTS, PHYSICS_VARIANT_SCHEMA_VERSION } from '../src/config/physics-variants.ts'

const PHYSICS_ACCEPTANCE_SCHEMA_VERSION = 2

const BASELINE_BUDGETS = {
  /** 以下是防回退预算，不是物理重构的最终目标。 */
  p95SettleSeconds: 3.5,
  p99SettleSeconds: 5.5,
  clusterAssistRate: 0,
  fallbackRate: 0,
  poseStableWindowRate: 0.02,
  ambiguousDiceRate: 0.03,
  conservativeBoundaryCrossingRate: 0.01,
  faceChangedDuringStableWindowRate: 0.01,
  maxContactPenetration: 0.1,
} as const

interface CliOptions {
  seeds: number
  baseSeed: number
  seed?: number
  json: boolean
}

function parsePositiveInteger(name: string, value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} 必须是正整数，收到 ${value}`)
  }
  return parsed
}

function parseSeed(name: string, value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`--${name} 必须是安全整数，收到 ${value}`)
  }
  return parsed
}

function parseArgs(): CliOptions {
  const values = new Map<string, string>()
  for (const arg of process.argv.slice(2)) {
    const match = arg.match(/^--([\w-]+)(?:=(.*))?$/)
    if (!match) throw new Error(`不支持的参数：${arg}`)
    values.set(match[1], match[2] ?? 'true')
  }

  const seedValue = values.get('seed')
  return {
    seeds: parsePositiveInteger('seeds', values.get('seeds') ?? '200'),
    baseSeed: parseSeed('base-seed', values.get('base-seed') ?? '50000'),
    seed: seedValue === undefined ? undefined : parseSeed('seed', seedValue),
    json: values.get('json') === 'true',
  }
}

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  return sorted[index]
}

function currentCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

function cannonVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const manifest = require('cannon-es/package.json') as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

function createRunMetadata(options: CliOptions) {
  return {
    schemaVersion: PHYSICS_ACCEPTANCE_SCHEMA_VERSION,
    rollDiagnosticsSchemaVersion: ROLL_DIAGNOSTICS_SCHEMA_VERSION,
    variantSchemaVersion: PHYSICS_VARIANT_SCHEMA_VERSION,
    commit: currentCommit(),
    node: process.version,
    cannonEs: cannonVersion(),
    algorithms: {
      prng: 'mulberry32',
      throw: THROW_ALGORITHM_VERSION,
      throwRandomPlan: THROW_RANDOM_PLAN_VERSION,
      settle: SETTLE_ALGORITHM_VERSION,
      escapeGuard: ESCAPE_GUARD_VERSION,
    },
    variant: PHYSICS_VARIANTS.current,
    physics: PHYSICS,
    bowl: {
      heightfieldGridSize: HF_GRID_SIZE,
      wallCount: WALL_COUNT,
      wallRadius: WALL_RADIUS,
      wallHeight: WALL_HEIGHT,
      wallThickness: WALL_THICKNESS,
    },
    throw: THROW,
    settle: SETTLE,
    requested: options,
  }
}

function summarize(results: RollRunResult[]) {
  const times = results.map(({ settleTime }) => settleTime).sort((a, b) => a - b)
  const distribution = summarizeRollResults(results)
  const counts = new Map<string, number>()
  for (const { settleReason } of results) {
    counts.set(settleReason, (counts.get(settleReason) ?? 0) + 1)
  }

  return {
    seeds: results.length,
    settleReasons: Object.fromEntries(counts),
    timeoutCount: results.filter(({ settleReason }) => settleReason === 'timeout').length,
    frameBudgetExhaustedCount: results.filter(
      ({ settleReason }) => settleReason === 'frame-budget-exhausted',
    ).length,
    poseStableWindowCount: results.filter(
      ({ settleReason }) => settleReason === 'pose-stable-window',
    ).length,
    nanCount: results.filter(({ nanDetected }) => nanDetected).length,
    wallCrossingSeeds: results.filter(({ wallCenterCrossings }) => wallCenterCrossings > 0).length,
    escapeGuardInterventions: results.reduce(
      (sum, { escapeGuardInterventionCount }) => sum + escapeGuardInterventionCount,
      0,
    ),
    assistInterventions: results.reduce(
      (sum, { assistInterventionCount }) => sum + assistInterventionCount,
      0,
    ),
    sleepWakeCount: results.reduce((sum, result) => sum + result.sleepWakeCount, 0),
    ambiguousDiceCount: results.reduce((sum, result) => sum + result.ambiguousDiceCount, 0),
    faceChangedDuringStableWindowSeeds: results.filter(
      ({ faceChangedDuringStableWindow }) => faceChangedDuringStableWindow,
    ).length,
    conservativeBoundaryCrossingSeeds: results.filter(
      ({ conservativeBoundaryCrossings }) => conservativeBoundaryCrossings > 0,
    ).length,
    fallbackCount: results.filter(
      ({ throwDiagnostics }) => throwDiagnostics.placementPath === 'fallback',
    ).length,
    maxRadius: Math.max(...results.map(({ maxRadius }) => maxRadius)),
    maxFinalSpeed: Math.max(...results.map(({ finalMaxSpeed }) => finalMaxSpeed)),
    maxFinalAngularSpeed: Math.max(
      ...results.map(({ finalMaxAngularSpeed }) => finalMaxAngularSpeed),
    ),
    maxContactPenetration: Math.max(
      ...results.map(({ maxContactPenetration }) => maxContactPenetration),
    ),
    maxStableWindowPositionDrift: Math.max(
      ...results.map(({ maxStableWindowPositionDrift }) => maxStableWindowPositionDrift),
    ),
    maxStableWindowAngularDrift: Math.max(
      ...results.map(({ maxStableWindowAngularDrift }) => maxStableWindowAngularDrift),
    ),
    longestStableWindow: Math.max(...results.map(({ longestStableWindow }) => longestStableWindow)),
    faceCounts: distribution.faceCounts,
    faceCountsByDie: distribution.faceCountsByDie,
    sumCounts: distribution.sumCounts,
    prizeCounts: distribution.prizeCounts,
    settleSeconds: {
      p50: percentile(times, 0.5),
      p95: percentile(times, 0.95),
      p99: percentile(times, 0.99),
      max: times.at(-1),
    },
  }
}

function runCurrentRoll(seed: number): RollRunResult {
  const variant = PHYSICS_VARIANTS.current
  return runRoll({
    seed,
    throwPlacementAlgorithm: variant.throwPlacementAlgorithm,
    contactClusterAssistEnabled: variant.contactClusterAssistEnabled,
    poseStableWindowEnabled: variant.poseStableWindowEnabled,
  })
}

const options = parseArgs()
const seeds =
  options.seed === undefined
    ? Array.from({ length: options.seeds }, (_, index) => options.baseSeed + index * 1000)
    : [options.seed]
const results = seeds.map(runCurrentRoll)
const continuationChecks = results
  .filter(({ settleReason }) => settleReason !== 'natural-sleep')
  .map((result) => {
    const continuation = runRoll({
      seed: result.seed,
      throwPlacementAlgorithm: result.throwDiagnostics.algorithm,
      contactClusterAssistEnabled: false,
      poseStableWindowEnabled: false,
      settlementPolicy: 'natural-continuation',
      maxFrames: Math.ceil(20 / PHYSICS.fixedTimeStep),
    })
    return {
      seed: result.seed,
      comparison: compareRollContinuation(result, continuation),
      continuation,
    }
  })
const summary = summarize(results)
const metadata = createRunMetadata(options)
const continuationSummary = {
  count: continuationChecks.length,
  seeds: continuationChecks.map(({ seed }) => seed),
  exhaustedSeeds: continuationChecks
    .filter(({ comparison }) => comparison.exhausted)
    .map(({ seed }) => seed),
  faceDiffSeeds: continuationChecks
    .filter(({ comparison }) => comparison.faceDiff)
    .map(({ seed }) => seed),
  tiltDiffSeeds: continuationChecks
    .filter(({ comparison }) => comparison.tiltDiff)
    .map(({ seed }) => seed),
  prizeDiffSeeds: continuationChecks
    .filter(({ comparison }) => comparison.prizeDiff)
    .map(({ seed }) => seed),
  safetyFailureSeeds: continuationChecks
    .filter(({ comparison }) => comparison.safetyFailures.length > 0)
    .map(({ seed }) => seed),
}

if (options.json || options.seed !== undefined) {
  process.stdout.write(
    `${JSON.stringify(
      {
        metadata,
        summary,
        continuationSummary,
        rolls: results.map(serializeRollResult),
        continuations: continuationChecks.map(({ seed, comparison, continuation }) => ({
          seed,
          comparison,
          result: serializeRollResult(continuation),
        })),
      },
      null,
      2,
    )}\n`,
  )
} else {
  process.stdout.write(`${JSON.stringify({ metadata, summary, continuationSummary }, null, 2)}\n`)
}

const failures = results.filter(
  ({ nanDetected, wallCenterCrossings, escapeGuardInterventionCount, settleReason }) =>
    nanDetected ||
    wallCenterCrossings > 0 ||
    escapeGuardInterventionCount > 0 ||
    settleReason === 'timeout' ||
    settleReason === 'frame-budget-exhausted',
)
if (failures.length > 0) {
  console.error(
    `物理验收失败：${failures.length}/${results.length}；复现 seed：${failures
      .map(({ seed }) => seed)
      .join(', ')}`,
  )
  process.exitCode = 1
}

const continuationFailures = continuationChecks.filter(
  ({ comparison }) =>
    comparison.faceDiff ||
    comparison.tiltDiff ||
    comparison.prizeDiff ||
    comparison.safetyFailures.length > 0,
)
if (continuationFailures.length > 0) {
  console.error(
    `非自然结算反事实失败：${continuationFailures.length}/${continuationChecks.length}；复现 seed：${continuationFailures
      .map(({ seed }) => seed)
      .join(', ')}`,
  )
  process.exitCode = 1
}

if (options.seed === undefined) {
  const budgetFailures: string[] = []
  const clusterAssistCount = results.filter(
    ({ settleReason }) => settleReason === 'cluster-assist',
  ).length
  const fallbackCount = results.filter(
    ({ throwDiagnostics }) => throwDiagnostics.placementPath === 'fallback',
  ).length
  const poseStableWindowCount = results.filter(
    ({ settleReason }) => settleReason === 'pose-stable-window',
  ).length
  const ambiguousDiceCount = results.reduce((sum, result) => sum + result.ambiguousDiceCount, 0)
  const conservativeCrossingCount = results.filter(
    ({ conservativeBoundaryCrossings }) => conservativeBoundaryCrossings > 0,
  ).length
  const faceChangedCount = results.filter(
    ({ faceChangedDuringStableWindow }) => faceChangedDuringStableWindow,
  ).length

  if ((summary.settleSeconds.p95 ?? Infinity) > BASELINE_BUDGETS.p95SettleSeconds) {
    budgetFailures.push(`p95>${BASELINE_BUDGETS.p95SettleSeconds}s`)
  }
  if ((summary.settleSeconds.p99 ?? Infinity) > BASELINE_BUDGETS.p99SettleSeconds) {
    budgetFailures.push(`p99>${BASELINE_BUDGETS.p99SettleSeconds}s`)
  }
  if (clusterAssistCount / results.length > BASELINE_BUDGETS.clusterAssistRate) {
    budgetFailures.push(`cluster-assist>${BASELINE_BUDGETS.clusterAssistRate * 100}%`)
  }
  if (fallbackCount / results.length > BASELINE_BUDGETS.fallbackRate) {
    budgetFailures.push(`fallback>${BASELINE_BUDGETS.fallbackRate * 100}%`)
  }
  if (poseStableWindowCount / results.length > BASELINE_BUDGETS.poseStableWindowRate) {
    budgetFailures.push(`pose-stable-window>${BASELINE_BUDGETS.poseStableWindowRate * 100}%`)
  }
  if (ambiguousDiceCount / (results.length * 6) > BASELINE_BUDGETS.ambiguousDiceRate) {
    budgetFailures.push(`ambiguous dice>${BASELINE_BUDGETS.ambiguousDiceRate * 100}%`)
  }
  if (
    conservativeCrossingCount / results.length >
    BASELINE_BUDGETS.conservativeBoundaryCrossingRate
  ) {
    budgetFailures.push(
      `conservative boundary crossing>${BASELINE_BUDGETS.conservativeBoundaryCrossingRate * 100}%`,
    )
  }
  if (faceChangedCount / results.length > BASELINE_BUDGETS.faceChangedDuringStableWindowRate) {
    budgetFailures.push(
      `stable-window face change>${BASELINE_BUDGETS.faceChangedDuringStableWindowRate * 100}%`,
    )
  }
  if (summary.maxContactPenetration > BASELINE_BUDGETS.maxContactPenetration) {
    budgetFailures.push(`contact penetration>${BASELINE_BUDGETS.maxContactPenetration}m`)
  }

  if (budgetFailures.length > 0) {
    console.error(`基线预算回退：${budgetFailures.join('，')}`)
    process.exitCode = 1
  }
}
