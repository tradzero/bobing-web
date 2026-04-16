/**
 * 快速阻尼调参实验
 * 测试不同 linearDamping / angularDamping 对 chamfer 的 timeout 率和 tilt 率影响
 */
import { runTrial, parseArgs, formatDuration, type SettlePath } from './lib/run-trial'

const args = parseArgs()
const N = parseInt(args['seeds'] ?? '100', 10)
const BASE_SEED = 50000

interface DampingVariant {
  label: string
  linear: number
  angular: number
}

const VARIANTS: DampingVariant[] = [
  { label: 'current (0.30/0.30)', linear: 0.30, angular: 0.30 },
  { label: 'ld=0.35 ad=0.35', linear: 0.35, angular: 0.35 },
  { label: 'ld=0.40 ad=0.40', linear: 0.40, angular: 0.40 },
  { label: 'ld=0.35 ad=0.45', linear: 0.35, angular: 0.45 },
  { label: 'ld=0.30 ad=0.45', linear: 0.30, angular: 0.45 },
  { label: 'ld=0.40 ad=0.50', linear: 0.40, angular: 0.50 },
]

console.log(`damping-tune: ${N} seeds × ${VARIANTS.length} 变体 (chamfer)\n`)

for (let vi = 0; vi < VARIANTS.length; vi++) {
  const v = VARIANTS[vi]
  const t0 = Date.now()
  let tiltDice = 0
  let tiltRounds = 0
  let timeoutCount = 0
  let sleepCount = 0
  const times: number[] = []

  for (let i = 0; i < N; i++) {
    const seed = BASE_SEED + i * 1000
    const r = runTrial({
      seed,
      linearDamping: v.linear,
      angularDamping: v.angular,
    })
    times.push(r.settleTime)
    tiltDice += r.tiltCount
    if (r.tiltCount > 0) tiltRounds++
    if (r.settlePath === 'timeout') timeoutCount++
    if (r.settlePath === 'sleep') sleepCount++
  }

  times.sort((a, b) => a - b)
  const avg = times.reduce((s, t) => s + t, 0) / N
  const p95 = times[Math.floor(N * 0.95)]
  const elapsed = formatDuration(Date.now() - t0)

  console.log(
    `  ${v.label.padEnd(22)} ` +
    `timeout=${String(timeoutCount).padStart(3)} (${(timeoutCount/N*100).toFixed(0)}%)  ` +
    `tilt=${String(tiltDice).padStart(2)}  ` +
    `sleep=${String(sleepCount).padStart(3)}  ` +
    `avg=${avg.toFixed(2)}s  p95=${p95.toFixed(2)}s  ` +
    `(${elapsed})`
  )
}
