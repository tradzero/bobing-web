import { execFileSync } from 'node:child_process'
import { runRoll, serializeRollResult, type RollRunResult } from '@dice/physics-core'
import {
  compareRollContinuation,
  DEFAULT_PHYSICS_AB_WATCH_SEEDS,
} from '@dice/physics-core/lab/roll-comparison'

const sizeArg = process.argv.find((arg) => arg.startsWith('--seeds='))
const count = sizeArg ? Number(sizeArg.split('=')[1]) : 1_000
if (!Number.isSafeInteger(count) || count < 200) throw new Error('--seeds 必须是至少 200 的整数')
const candidateArg = process.argv.find((arg) => arg.startsWith('--candidate='))
const candidateIterations = candidateArg ? Number(candidateArg.split('=')[1]) : 20
if (![15, 20].includes(candidateIterations)) throw new Error('--candidate 只接受 15 或 20')
const watchSeeds = [
  ...new Set([
    ...DEFAULT_PHYSICS_AB_WATCH_SEEDS,
    991_817,
    935_649,
    25_042,
    105_000,
    113_000,
    166_000,
    206_000,
    171_042,
    146_042,
    1776308075747,
    1776308125213,
    1776308167330,
    1776308186180,
    1776308201964,
    1776308150130,
  ]),
]
const batchSeeds = Array.from({ length: count }, (_, index) => 50_000 + index * 1_003)
const records: { group: string; iterations: number; result: RollRunResult; cpuMs: number }[] = []
const continuations: {
  seed: number
  iterations: number
  comparison: ReturnType<typeof compareRollContinuation>
}[] = []
// 先固定验收标准，再执行；watch 和批量样本分别统计，避免长尾样本改变总体分位数。
const budgets = { p95Ratio: 0.9, p99Ratio: 0.9, maxTiltRateIncrease: 0.01, maxPenetration: 0.1 }
for (const iterations of [10, candidateIterations])
  runRoll({ seed: 42, solverIterations: iterations })
for (const [group, seeds] of [
  ['watch', watchSeeds],
  ['batch', batchSeeds],
] as const) {
  for (const [index, seed] of seeds.entries()) {
    for (const iterations of index % 2 ? [candidateIterations, 10] : [10, candidateIterations]) {
      const start = performance.now()
      const result = runRoll({ seed, solverIterations: iterations })
      records.push({ group, iterations, result, cpuMs: performance.now() - start })
      if (result.settleReason !== 'natural-sleep') {
        const continuation = runRoll({
          seed,
          solverIterations: iterations,
          settlementPolicy: 'natural-continuation',
          maxFrames: 1_200,
        })
        continuations.push({
          seed,
          iterations,
          comparison: compareRollContinuation(result, continuation),
        })
      }
    }
  }
}
function summarize(group: string, iterations: number) {
  const rows = records.filter((row) => row.group === group && row.iterations === iterations)
  const times = rows.map(({ result }) => result.settleTime).sort((a, b) => a - b)
  const reasons: Record<string, number> = {}
  for (const { result } of rows)
    reasons[result.settleReason] = (reasons[result.settleReason] ?? 0) + 1
  return {
    count: rows.length,
    p95: times[Math.floor(times.length * 0.95)],
    p99: times[Math.floor(times.length * 0.99)],
    max: times.at(-1),
    tiltRate: rows.filter(({ result }) => result.ambiguousDiceCount > 0).length / rows.length,
    meanCpuMs: rows.reduce((sum, row) => sum + row.cpuMs, 0) / rows.length,
    meanStepCpuMs:
      rows.reduce((sum, row) => sum + row.cpuMs / row.result.simulationStep, 0) / rows.length,
    maxPenetration: Math.max(...rows.map(({ result }) => result.maxContactPenetration)),
    reasons,
    safetyFailures: rows
      .filter(
        ({ result: r }) =>
          r.nanDetected ||
          r.wallCenterCrossings ||
          r.escapeGuardInterventionCount ||
          !r.floorRelaunch.available ||
          r.floorRelaunch.relaunchEventCount ||
          /timeout|exhausted/.test(r.settleReason),
      )
      .map(({ result }) => result.seed),
  }
}
const baseline = summarize('batch', 10)
const candidate = summarize('batch', candidateIterations)
const watch = {
  baseline: summarize('watch', 10),
  candidate: summarize('watch', candidateIterations),
}
const failedContinuations = continuations.filter(
  ({ iterations, comparison: c }) =>
    iterations === candidateIterations &&
    (c.exhausted || c.faceDiff || c.tiltDiff || c.prizeDiff || c.safetyFailures.length > 0),
)
const passed =
  candidate.p95 <= baseline.p95 * budgets.p95Ratio &&
  candidate.p99 <= baseline.p99 * budgets.p99Ratio &&
  candidate.tiltRate <= baseline.tiltRate + budgets.maxTiltRateIncrease &&
  candidate.maxPenetration <= budgets.maxPenetration &&
  candidate.safetyFailures.length === 0 &&
  watch.candidate.safetyFailures.length === 0 &&
  failedContinuations.length === 0
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      node: process.version,
      candidateIterations,
      budgets,
      passed,
      baseline,
      candidate,
      watch,
      continuations,
      records: records.map(({ result, ...row }) => ({
        ...row,
        result: serializeRollResult(result),
      })),
    },
    null,
    2,
  ),
)
if (!passed) process.exitCode = 1
