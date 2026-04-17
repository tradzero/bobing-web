/**
 * 抖动/斜停种子诊断
 * 对指定种子 × 参数变体做逐帧倾角追踪
 *
 * 用法:
 *   pnpm sweep:jitter                        # 默认 6 种子 × 全变体
 *   pnpm sweep:jitter -- --seeds=1776310976115,1776311021115
 *   pnpm sweep:jitter -- --variant=0,1       # 只跑第 0、1 个变体
 *
 * 输出: logs/jitter-diagnose-<timestamp>.ndjson + .summary.txt
 */
import * as CANNON from 'cannon-es'
import { DEFAULT_SWEEP_CHAMFER_RATIO, runTrial, parseArgs, formatDuration } from './lib/run-trial'
import { createLogger } from './lib/log'
import { SETTLE } from '@/config/settle'
import type { ShapeMode } from '@/dice/dice-body'

/** 六面法线（用于帧级倾角追踪） */
const FACE_NORMALS = [
  new CANNON.Vec3(0, 1, 0), new CANNON.Vec3(0, -1, 0),
  new CANNON.Vec3(1, 0, 0), new CANNON.Vec3(-1, 0, 0),
  new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(0, 0, -1),
]
const UP = new CANNON.Vec3(0, 1, 0)

function getMaxTiltAngle(body: CANNON.Body): number {
  let maxDot = -1
  const worldNormal = new CANNON.Vec3()
  for (const fn of FACE_NORMALS) {
    body.quaternion.vmult(fn, worldNormal)
    const d = worldNormal.dot(UP)
    if (d > maxDot) maxDot = d
  }
  return Math.acos(Math.min(1, maxDot)) * (180 / Math.PI)
}

interface VariantConfig {
  label: string
  diceDiceFriction: number
  diceDiceRestitution: number
  sleepTimeLimit: number
  shapeMode?: ShapeMode
  chamferRatio?: number
}

const ALL_VARIANTS: VariantConfig[] = [
  { label: 'box baseline (f=0.30 r=0.25)', diceDiceFriction: 0.30, diceDiceRestitution: 0.25, sleepTimeLimit: 0.32, shapeMode: 'box' },
  { label: 'chamfer baseline (f=0.30 r=0.25)', diceDiceFriction: 0.30, diceDiceRestitution: 0.25, sleepTimeLimit: 0.32, shapeMode: 'chamfer', chamferRatio: DEFAULT_SWEEP_CHAMFER_RATIO },
  { label: 'f=0.27', diceDiceFriction: 0.27, diceDiceRestitution: 0.25, sleepTimeLimit: 0.32 },
  { label: 'f=0.25', diceDiceFriction: 0.25, diceDiceRestitution: 0.25, sleepTimeLimit: 0.32 },
  { label: 'f=0.22', diceDiceFriction: 0.22, diceDiceRestitution: 0.25, sleepTimeLimit: 0.32 },
  { label: 'r=0.22', diceDiceFriction: 0.30, diceDiceRestitution: 0.22, sleepTimeLimit: 0.32 },
  { label: 'r=0.20', diceDiceFriction: 0.30, diceDiceRestitution: 0.20, sleepTimeLimit: 0.32 },
  { label: 'f=0.27 r=0.22', diceDiceFriction: 0.27, diceDiceRestitution: 0.22, sleepTimeLimit: 0.32 },
  { label: 'f=0.25 r=0.22', diceDiceFriction: 0.25, diceDiceRestitution: 0.22, sleepTimeLimit: 0.32 },
  { label: 'f=0.27 r=0.20', diceDiceFriction: 0.27, diceDiceRestitution: 0.20, sleepTimeLimit: 0.32 },
]

const DEFAULT_SEEDS = [
  1776310976115,  // 抖动 seed
  1776311021115,  // 抖动 seed
  1776308150130,  // tilt seed
  1776305112201,  // f=0.22 回归 seed
  1776308167330,  // f=0.22 受益 seed
  1776305192933,  // 慢结算 seed
]

// ── CLI 参数 ──
const args = parseArgs()
const seeds = args['seeds']
  ? args['seeds'].split(',').map(Number)
  : DEFAULT_SEEDS
const variantFilter = args['variant']
  ? args['variant'].split(',').map(Number)
  : undefined
const variants = variantFilter
  ? ALL_VARIANTS.filter((_, i) => variantFilter.includes(i))
  : ALL_VARIANTS

const log = createLogger('jitter-diagnose')
console.log(`jitter-diagnose: ${seeds.length} seeds × ${variants.length} 变体, 日志 → ${log.filePath}`)

const totalStart = Date.now()

for (const seed of seeds) {
  console.log(`\n=== seed ${seed} ===`)

  for (const v of variants) {
    // 使用 onFrame 追踪 peak 倾角
    const peakAngles = new Array(6).fill(0)
    const snapshots: Array<{ t: number; maxV: number; maxAV: number; awake: number }> = []

    const r = runTrial({
      seed,
      shapeMode: v.shapeMode,
      chamferRatio: v.chamferRatio,
      diceDiceFriction: v.diceDiceFriction,
      diceDiceRestitution: v.diceDiceRestitution,
      sleepTimeLimit: v.sleepTimeLimit,
      onFrame(frame, t, bodies) {
        // 跳过前 0.5s 自由飞行阶段
        if (t > 0.5) {
          for (let d = 0; d < 6; d++) {
            const angle = getMaxTiltAngle(bodies[d])
            if (angle > peakAngles[d]) peakAngles[d] = angle
          }
        }
        if (frame % 30 === 0) {
          snapshots.push({
            t,
            maxV: Math.max(...bodies.map((b) => b.velocity.length())),
            maxAV: Math.max(...bodies.map((b) => b.angularVelocity.length())),
            awake: bodies.filter((b) => b.sleepState !== CANNON.Body.SLEEPING).length,
          })
        }
      },
    })

    const finalMaxAngle = Math.max(
      ...r.faces.map((d) => Math.acos(Math.min(1, d.confidence)) * (180 / Math.PI)),
    )
    const overallPeakAngle = Math.max(...peakAngles)
    const hasTilt = r.faces.some((d) => d.confidence < SETTLE.tiltThreshold)

    log.append({
      seed,
      variant: v.label,
      settlePath: r.settlePath,
      settleTime: +r.settleTime.toFixed(3),
      finalMaxAngle: +finalMaxAngle.toFixed(1),
      overallPeakAngle: +overallPeakAngle.toFixed(1),
      hasTilt,
      peakAngles: peakAngles.map((a) => +a.toFixed(1)),
    })

    const line =
      `  [${v.label.padEnd(28)}] ` +
      `path=${r.settlePath} time=${r.settleTime.toFixed(2)}s ` +
      `finalMax=${finalMaxAngle.toFixed(1)}° ` +
      `peakMax=${overallPeakAngle.toFixed(1)}° ` +
      `tilt=${hasTilt}`
    console.log(line)
  }
}

const total = formatDuration(Date.now() - totalStart)
console.log(`\n完成, 耗时 ${total}`)
console.log(`日志: ${log.filePath}`)
