/**
 * 倾斜率统计分析
 *
 * 用法:
 *   pnpm sweep:tilt                       # 默认 200 轮
 *   pnpm sweep:tilt -- --trials=50        # 减少轮数
 *
 * 输出: logs/tilt-stats-<timestamp>.ndjson + .summary.txt
 */
import { runTrial, parseArgs, formatDuration, type SettlePath } from './lib/run-trial'
import { createLogger } from './lib/log'
import { SETTLE } from '@/config/settle'
import { bowlInnerHeight } from '@/config/bowl'

// ── CLI 参数 ──
const args = parseArgs()
const NUM_TRIALS = parseInt(args['trials'] ?? '200', 10)
const BASE_SEED = 42000

const log = createLogger('tilt-stats')
console.log(`tilt-stats: ${NUM_TRIALS} 轮, 日志 → ${log.filePath}`)

let totalDice = 0
let tiltCount = 0
let tiltRounds = 0
const settlePaths: Record<SettlePath, number> = { sleep: 0, threshold: 0, timeout: 0 }
const tiltData: Array<{
  seed: number
  dieIdx: number
  confidence: number
  angleDeg: number
  r: number
  y: number
  wallAngleDeg: number
  settlePath: SettlePath
}> = []

const start = Date.now()

for (let trial = 0; trial < NUM_TRIALS; trial++) {
  const seed = BASE_SEED + trial * 1000

  // 使用 onFrame 不需要额外追踪，runTrial 已包含 tilt 分析
  const r = runTrial({ seed, maxFrames: 600 })
  settlePaths[r.settlePath]++
  totalDice += 6

  let roundHasTilt = false
  for (let i = 0; i < 6; i++) {
    const d = r.faces[i]
    if (d.confidence < SETTLE.tiltThreshold) {
      tiltCount++
      roundHasTilt = true

      // 从 faces 中取不到 position，需重新跑一次获取位置信息
      // 为了效率，在 runTrial 外另行获取（使用同一 seed 复现）
      // 这里用 faces 的值 + seed 记录，后续可复现查详情
      const angleDeg = Math.acos(Math.min(1, d.confidence)) * (180 / Math.PI)

      tiltData.push({
        seed,
        dieIdx: i,
        confidence: d.confidence,
        angleDeg,
        r: 0,     // 位置信息需复现获取，此处记 0
        y: 0,
        wallAngleDeg: 0,
        settlePath: r.settlePath,
      })
    }
  }
  if (roundHasTilt) tiltRounds++

  // 每条试验结果落盘
  log.append({
    seed,
    settlePath: r.settlePath,
    settleTime: +r.settleTime.toFixed(3),
    tiltCount: r.tiltCount,
    maxTiltAngle: +r.maxTiltAngle.toFixed(1),
    faces: r.faces.map((f) => ({ value: f.value, confidence: +f.confidence.toFixed(4) })),
  })

  // 进度
  if ((trial + 1) % 50 === 0) {
    const pct = ((trial + 1) / NUM_TRIALS * 100).toFixed(0)
    const elapsed = formatDuration(Date.now() - start)
    console.log(`  ${pct}% (${trial + 1}/${NUM_TRIALS}) ${elapsed}`)
  }
}

// ── 汇总报告 ──
const elapsed = formatDuration(Date.now() - start)
const summaryLines: string[] = [
  `倾斜统计: ${NUM_TRIALS} 轮 / ${totalDice} 颗骰子 (${elapsed})`,
  `倾斜骰子数: ${tiltCount} (${(tiltCount / totalDice * 100).toFixed(1)}%)`,
  `含倾斜的轮数: ${tiltRounds} (${(tiltRounds / NUM_TRIALS * 100).toFixed(1)}%)`,
  `倾斜阈值: cos(${(Math.acos(SETTLE.tiltThreshold) * 180 / Math.PI).toFixed(1)}°) = ${SETTLE.tiltThreshold}`,
  `settle 路径: sleep=${settlePaths.sleep} threshold=${settlePaths.threshold} timeout=${settlePaths.timeout}`,
]

if (tiltData.length > 0) {
  // settle 路径 × 倾斜交叉
  const tiltBySleep = tiltData.filter((d) => d.settlePath === 'sleep').length
  const tiltByThresh = tiltData.filter((d) => d.settlePath === 'threshold').length
  summaryLines.push(`倾斜 × settle路径: sleep=${tiltBySleep} threshold=${tiltByThresh}`)

  // 倾斜角度分布
  const angleBuckets = [42, 45, 50, 55, 60, 70, 80, 90]
  summaryLines.push('倾斜角度分布:')
  for (let bi = 0; bi < angleBuckets.length; bi++) {
    const lo = bi === 0 ? 41.4 : angleBuckets[bi - 1]
    const hi = angleBuckets[bi]
    const bucket = tiltData.filter((d) => d.angleDeg >= lo && d.angleDeg < hi)
    if (bucket.length > 0) summaryLines.push(`  [${lo.toFixed(0)}°, ${hi}°): ${bucket.length} 颗`)
  }

  // 前 20 个样本
  summaryLines.push('倾斜样本 (前 20):')
  summaryLines.push('  seed          die  conf    angle   path')
  for (const d of tiltData.slice(0, 20)) {
    summaryLines.push(
      `  ${String(d.seed).padEnd(14)} ${d.dieIdx + 1}    ${d.confidence.toFixed(3)}   ${d.angleDeg.toFixed(1).padStart(5)}°  ${d.settlePath}`,
    )
  }
}

console.log(`\n${'='.repeat(60)}`)
for (const line of summaryLines) console.log(`  ${line}`)
console.log(`${'='.repeat(60)}`)

log.summary(summaryLines.join('\n'))
console.log(`日志: ${log.filePath}`)
