/**
 * diceDice friction + restitution 参数扫描
 *
 * 用法:
 *   pnpm sweep:param                     # 默认 500 seed × 全变体
 *   pnpm sweep:param -- --seeds=100      # 减少 seed 数量
 *   pnpm sweep:param -- --variant=0,1    # 只跑第 0、1 个变体
 *
 * 输出: logs/param-sweep-<timestamp>.ndjson + .summary.txt
 */
import { runTrial, parseArgs, formatDuration, type SettlePath } from './lib/run-trial'
import { createLogger } from './lib/log'
import type { ShapeMode } from '@/dice/dice-body'

interface Variant {
  label: string
  friction: number
  restitution: number
  shapeMode?: ShapeMode
}

const ALL_VARIANTS: Variant[] = [
  { label: 'box baseline (f=0.30 r=0.25)', friction: 0.30, restitution: 0.25, shapeMode: 'box' },
  { label: 'chamfer baseline (f=0.30 r=0.25)', friction: 0.30, restitution: 0.25 },
  { label: 'f=0.22 only', friction: 0.22, restitution: 0.25 },
  { label: 'r=0.20 only', friction: 0.30, restitution: 0.20 },
  { label: 'f=0.27 r=0.20', friction: 0.27, restitution: 0.20 },
  { label: 'f=0.25 r=0.20', friction: 0.25, restitution: 0.20 },
]

const SPECIAL_SEEDS = [
  { seed: 1776310976115, desc: '抖动1' },
  { seed: 1776311021115, desc: '抖动2' },
  { seed: 1776308150130, desc: 'tilt已知' },
  { seed: 1776305112201, desc: 'f022回归' },
  { seed: 1776308167330, desc: 'tilt已知2' },
  { seed: 1776305192933, desc: '慢结算' },
  { seed: 5555, desc: '烟雾测试' },
  { seed: 314159, desc: '碗结算' },
]

// ── CLI 参数 ──
const args = parseArgs()
const N = parseInt(args['seeds'] ?? '500', 10)
const BASE_SEED = 50000
const variantFilter = args['variant']
  ? args['variant'].split(',').map(Number)
  : undefined
const variants = variantFilter
  ? ALL_VARIANTS.filter((_, i) => variantFilter.includes(i))
  : ALL_VARIANTS

const log = createLogger('param-sweep')
console.log(`param-sweep: ${N} seeds × ${variants.length} 变体, 日志 → ${log.filePath}`)

const summaryLines: string[] = []
const totalStart = Date.now()

for (let vi = 0; vi < variants.length; vi++) {
  const v = variants[vi]
  const vStart = Date.now()
  let tiltDice = 0
  let tiltRounds = 0
  let timeoutCount = 0
  const times: number[] = []

  // ── 批量 seed ──
  for (let i = 0; i < N; i++) {
    const seed = BASE_SEED + i * 1000
    const r = runTrial({
      seed,
      shapeMode: v.shapeMode,
      diceDiceFriction: v.friction,
      diceDiceRestitution: v.restitution,
    })
    times.push(r.settleTime)
    tiltDice += r.tiltCount
    if (r.tiltCount > 0) tiltRounds++
    if (r.settlePath === 'timeout') timeoutCount++

    // 每条立即落盘
    log.append({
      type: 'trial',
      variant: v.label,
      seed,
      settlePath: r.settlePath,
      settleTime: +r.settleTime.toFixed(3),
      tiltCount: r.tiltCount,
      maxTiltAngle: +r.maxTiltAngle.toFixed(1),
    })
  }

  // ── 特殊 seed ──
  for (const { seed, desc } of SPECIAL_SEEDS) {
    const r = runTrial({
      seed,
      shapeMode: v.shapeMode,
      diceDiceFriction: v.friction,
      diceDiceRestitution: v.restitution,
    })
    log.append({
      type: 'special',
      variant: v.label,
      seed,
      desc,
      settlePath: r.settlePath,
      settleTime: +r.settleTime.toFixed(3),
      tiltCount: r.tiltCount,
      maxTiltAngle: +r.maxTiltAngle.toFixed(1),
    })
  }

  // ── 变体汇总 ──
  times.sort((a, b) => a - b)
  const avg = times.reduce((s, t) => s + t, 0) / N
  const p95 = times[Math.floor(N * 0.95)]
  const over5 = times.filter((t) => t > 5).length
  const over7 = times.filter((t) => t > 7).length
  const elapsed = formatDuration(Date.now() - vStart)

  const line =
    `[${v.label}] tiltDice=${tiltDice} tiltRounds=${tiltRounds} timeout=${timeoutCount} ` +
    `avg=${avg.toFixed(2)}s p95=${p95.toFixed(2)}s >5s=${over5} >7s=${over7} (${elapsed})`
  console.log(`  ${vi + 1}/${variants.length} ${line}`)
  summaryLines.push(line)
}

const total = formatDuration(Date.now() - totalStart)
summaryLines.push(`\n总计: ${N} seeds × ${variants.length} 变体, 耗时 ${total}`)
log.summary(summaryLines.join('\n'))
console.log(`\n完成, 耗时 ${total}`)
console.log(`日志: ${log.filePath}`)
