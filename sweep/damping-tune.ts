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
  { label: 'current (0.30/0.30)', linear: 0.3, angular: 0.3 },
  { label: 'ld=0.35 ad=0.35', linear: 0.35, angular: 0.35 },
  { label: 'ld=0.40 ad=0.40', linear: 0.4, angular: 0.4 },
  { label: 'ld=0.35 ad=0.45', linear: 0.35, angular: 0.45 },
  { label: 'ld=0.30 ad=0.45', linear: 0.3, angular: 0.45 },
  { label: 'ld=0.40 ad=0.50', linear: 0.4, angular: 0.5 },
]

console.log(`damping-tune: ${N} seeds × ${VARIANTS.length} 变体 (chamfer)\n`)

for (let vi = 0; vi < VARIANTS.length; vi++) {
  const v = VARIANTS[vi]
  const t0 = Date.now()
  let tiltDice = 0
  const settlePaths: Record<SettlePath, number> = {
    'natural-sleep': 0,
    'stable-window': 0,
    'pose-stable-window': 0,
    'cluster-assist': 0,
    timeout: 0,
  }
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
    settlePaths[r.settlePath]++
  }

  times.sort((a, b) => a - b)
  const avg = times.reduce((s, t) => s + t, 0) / N
  const p95 = times[Math.floor(N * 0.95)]
  const elapsed = formatDuration(Date.now() - t0)

  console.log(
    `  ${v.label.padEnd(22)} ` +
      `timeout=${String(settlePaths.timeout).padStart(3)} (${((settlePaths.timeout / N) * 100).toFixed(0)}%)  ` +
      `tilt=${String(tiltDice).padStart(2)}  ` +
      `natural-sleep=${String(settlePaths['natural-sleep']).padStart(3)}  ` +
      `stable-window=${String(settlePaths['stable-window']).padStart(3)}  ` +
      `pose-stable=${String(settlePaths['pose-stable-window']).padStart(3)}  ` +
      `cluster-assist=${String(settlePaths['cluster-assist']).padStart(3)}  ` +
      `avg=${avg.toFixed(2)}s  p95=${p95.toFixed(2)}s  ` +
      `(${elapsed})`,
  )
}
