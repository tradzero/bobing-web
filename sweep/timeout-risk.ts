/**
 * timeout 风险统计（从 review-verify 问题1 独立出来）
 *
 * 用法:
 *   pnpm sweep:timeout                   # 默认 500 seed
 *   pnpm sweep:timeout -- --seeds=100    # 减少 seed 数量
 *
 * 输出: logs/timeout-risk-<timestamp>.ndjson + .summary.txt
 */
import { runTrial, parseArgs, formatDuration, type SettlePath } from './lib/run-trial'
import { createLogger } from './lib/log'

// ── CLI 参数 ──
const args = parseArgs()
const N = parseInt(args['seeds'] ?? '500', 10)
const BASE_SEED = 50000

const log = createLogger('timeout-risk')
console.log(`timeout-risk: ${N} seeds, 日志 → ${log.filePath}`)

const paths: Record<SettlePath, number> = {
  'natural-sleep': 0,
  'stable-window': 0,
  'pose-stable-window': 0,
  'cluster-assist': 0,
  timeout: 0,
}
const settleTimesAll: number[] = []
const settleTimesByPath: Record<SettlePath, number[]> = {
  'natural-sleep': [],
  'stable-window': [],
  'pose-stable-window': [],
  'cluster-assist': [],
  timeout: [],
}
const start = Date.now()

for (let i = 0; i < N; i++) {
  const seed = BASE_SEED + i * 1000
  const r = runTrial({ seed })
  paths[r.settlePath]++
  settleTimesAll.push(r.settleTime)
  settleTimesByPath[r.settlePath].push(r.settleTime)

  log.append({
    seed,
    settlePath: r.settlePath,
    settleTime: +r.settleTime.toFixed(3),
    tiltCount: r.tiltCount,
    maxTiltAngle: +r.maxTiltAngle.toFixed(1),
  })

  // 每 100 轮输出进度
  if ((i + 1) % 100 === 0) {
    const pct = (((i + 1) / N) * 100).toFixed(0)
    const elapsed = formatDuration(Date.now() - start)
    console.log(`  ${pct}% (${i + 1}/${N}) ${elapsed}`)
  }
}

// ── 汇总 ──
settleTimesAll.sort((a, b) => a - b)
const avg = settleTimesAll.reduce((s, t) => s + t, 0) / N
const p50 = settleTimesAll[Math.floor(N * 0.5)]
const p90 = settleTimesAll[Math.floor(N * 0.9)]
const p95 = settleTimesAll[Math.floor(N * 0.95)]
const p99 = settleTimesAll[Math.floor(N * 0.99)]
const over4s = settleTimesAll.filter((t) => t > 4).length
const over5s = settleTimesAll.filter((t) => t > 5).length
const timeoutRate = paths.timeout / N

const elapsed = formatDuration(Date.now() - start)
const summary = [
  `timeout 风险统计 (${N} 轮, ${elapsed})`,
  `settle 路径: natural-sleep=${paths['natural-sleep']} stable-window=${paths['stable-window']} pose-stable-window=${paths['pose-stable-window']} cluster-assist=${paths['cluster-assist']} timeout=${paths.timeout}`,
  `timeout 率: ${(timeoutRate * 100).toFixed(1)}%`,
  `结算时间: avg=${avg.toFixed(2)}s p50=${p50.toFixed(2)}s p90=${p90.toFixed(2)}s p95=${p95.toFixed(2)}s p99=${p99.toFixed(2)}s`,
  `>4s: ${over4s} (${((over4s / N) * 100).toFixed(1)}%)  >5s: ${over5s} (${((over5s / N) * 100).toFixed(1)}%)`,
]

if (settleTimesByPath.timeout.length > 0) {
  summary.push(
    `timeout 轮结算时间: ${settleTimesByPath.timeout.map((t) => t.toFixed(2)).join(', ')}`,
  )
}

console.log(`\n${'='.repeat(60)}`)
for (const line of summary) console.log(`  ${line}`)
console.log(`${'='.repeat(60)}`)

log.summary(summary.join('\n'))
console.log(`日志: ${log.filePath}`)

// 退出码: timeout 率超过 22% 为失败
if (timeoutRate >= 0.22) {
  console.error(`⚠ timeout 率 ${(timeoutRate * 100).toFixed(1)}% 超过 22% 阈值`)
  process.exit(1)
}
