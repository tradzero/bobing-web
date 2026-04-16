/**
 * sleepTimeLimit 参数扫描
 *
 * 用法:
 *   pnpm sweep:sleep                     # 默认 500 seed × 3 值
 *   pnpm sweep:sleep -- --seeds=100      # 减少 seed 数量
 *   pnpm sweep:sleep -- --values=0.32,0.28  # 指定 sleepTimeLimit 值
 *
 * 输出: logs/sleep-sweep-<timestamp>.ndjson + .summary.txt
 */
import { runTrial, parseArgs, formatDuration, type SettlePath } from './lib/run-trial'
import { createLogger } from './lib/log'

const DEFAULT_VALUES = [0.32, 0.30, 0.28]
const SLOW_SEEDS = [1776308075747, 1776308125213, 1776308167330, 1776308186180, 1776308201964]
const TILT_SEED = 1776308150130

// ── CLI 参数 ──
const args = parseArgs()
const N = parseInt(args['seeds'] ?? '500', 10)
const BASE_SEED = 50000
const sweepValues = args['values']
  ? args['values'].split(',').map(Number)
  : DEFAULT_VALUES

const log = createLogger('sleep-sweep')
console.log(`sleep-sweep: ${N} seeds × ${sweepValues.length} 值, 日志 → ${log.filePath}`)

const summaryLines: string[] = []
const totalStart = Date.now()

for (let vi = 0; vi < sweepValues.length; vi++) {
  const stl = sweepValues[vi]
  const vStart = Date.now()
  const paths: Record<SettlePath, number> = { sleep: 0, threshold: 0, timeout: 0 }
  const times: number[] = []
  let tiltDice = 0
  let tiltRounds = 0

  // ── 批量 seed ──
  for (let i = 0; i < N; i++) {
    const seed = BASE_SEED + i * 1000
    const r = runTrial({ seed, sleepTimeLimit: stl })
    paths[r.settlePath]++
    times.push(r.settleTime)
    tiltDice += r.tiltCount
    if (r.tiltCount > 0) tiltRounds++

    log.append({
      type: 'trial',
      sleepTimeLimit: stl,
      seed,
      settlePath: r.settlePath,
      settleTime: +r.settleTime.toFixed(3),
      tiltCount: r.tiltCount,
      maxTiltAngle: +r.maxTiltAngle.toFixed(1),
    })
  }

  // ── 慢结算种子 ──
  for (const seed of SLOW_SEEDS) {
    const r = runTrial({ seed, sleepTimeLimit: stl })
    log.append({
      type: 'slow-seed',
      sleepTimeLimit: stl,
      seed,
      settlePath: r.settlePath,
      settleTime: +r.settleTime.toFixed(3),
      tiltCount: r.tiltCount,
    })
  }

  // ── 倾斜种子 ──
  const tiltResult = runTrial({ seed: TILT_SEED, sleepTimeLimit: stl })
  log.append({
    type: 'tilt-seed',
    sleepTimeLimit: stl,
    seed: TILT_SEED,
    settlePath: tiltResult.settlePath,
    settleTime: +tiltResult.settleTime.toFixed(3),
    tiltCount: tiltResult.tiltCount,
    maxTiltAngle: +tiltResult.maxTiltAngle.toFixed(1),
  })

  // ── 变体汇总 ──
  times.sort((a, b) => a - b)
  const avg = times.reduce((s, t) => s + t, 0) / N
  const p50 = times[Math.floor(N * 0.5)]
  const p90 = times[Math.floor(N * 0.9)]
  const p95 = times[Math.floor(N * 0.95)]
  const over5s = times.filter((t) => t > 5).length
  const elapsed = formatDuration(Date.now() - vStart)

  const line =
    `[stl=${stl}] sleep=${paths.sleep} thresh=${paths.threshold} timeout=${paths.timeout} ` +
    `tilt=${tiltDice}/${N * 6} avg=${avg.toFixed(2)}s p50=${p50.toFixed(2)}s p90=${p90.toFixed(2)}s p95=${p95.toFixed(2)}s >5s=${over5s} (${elapsed})`
  console.log(`  ${vi + 1}/${sweepValues.length} ${line}`)
  summaryLines.push(line)
}

const total = formatDuration(Date.now() - totalStart)
summaryLines.push(`\n总计: ${N} seeds × ${sweepValues.length} 值, 耗时 ${total}`)
log.summary(summaryLines.join('\n'))
console.log(`\n完成, 耗时 ${total}`)
console.log(`日志: ${log.filePath}`)
