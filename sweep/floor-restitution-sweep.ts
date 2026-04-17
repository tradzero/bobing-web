/**
 * 碗底 restitution sweep
 *
 * 仅改碗底（bowlFloorMaterial）的 restitution，碗壁保持 0.15 不变
 * 对比档位：0.15（当前） / 0.08 / 0.05 / 0.02
 *
 * 同时检验：
 * 1. 二次弹跳是否减少（阶段 A/B 改善）
 * 2. 首次落碗后弹性感是否过死（"棉花碗"问题）
 * 3. 墙面回弹是否保持原设定（材质已拆开，应不受影响）
 */
import { PHYSICS } from '@/config/physics'
import { runTrial } from './lib/run-trial'

const RESTITUTION_VALUES = [0.15, 0.08, 0.05, 0.02]
const THROW_SEED = 1776390018022

interface Metrics {
  /** frame100+ 主问题骰子最大 Y 回升 (m) */
  maxYRise: number
  /** 主问题骰子 index */
  worstDie: number
  /** stable 打破次数 */
  stableBroken: number
  /** 全部 sleep 时间 (s) */
  sleepTime: number
  /** settle 路径 */
  settlePath: string
  /** 总时长 */
  duration: number
  /** 首次落碗后最大反弹高度（评估弹性感） */
  firstBounceHeight: number
  /** 每颗骰子 frame100+ Y delta */
  perDieDeltas: number[]
}

function runThrow(floorRestitution: number): Metrics {
  const post100MinY = new Array(6).fill(Infinity)
  const post100MaxY = new Array(6).fill(-Infinity)

  // 追踪首次落碗后的反弹高度（评估弹性感）
  let firstContactFrame = -1
  let firstBounceHeight = 0
  const dieMinYEarly = new Array(6).fill(Infinity)

  const trial = runTrial({
    seed: THROW_SEED,
    maxFrames: 1200,
    floorRestitution,
    onFrame(frame, _time, bodies) {
      if (firstContactFrame < 0 && bodies.every(b => b.position.y < 0.5)) {
        firstContactFrame = frame
      }
      if (firstContactFrame >= 0 && frame <= firstContactFrame + 30) {
        for (let i = 0; i < 6; i++) {
          const y = bodies[i].position.y
          if (y < dieMinYEarly[i]) dieMinYEarly[i] = y
          const bounce = y - dieMinYEarly[i]
          if (bounce > firstBounceHeight) firstBounceHeight = bounce
        }
      }
      if (frame < 100) return
      for (let i = 0; i < 6; i++) {
        const y = bodies[i].position.y
        if (y < post100MinY[i]) post100MinY[i] = y
        if (y > post100MaxY[i]) post100MaxY[i] = y
      }
    },
  })

  const yDeltas = post100MaxY.map((max, i) => max - post100MinY[i])
  const worstIdx = yDeltas.indexOf(Math.max(...yDeltas))

  return {
    maxYRise: yDeltas[worstIdx],
    worstDie: worstIdx,
    stableBroken: trial.stableBrokenCount,
    sleepTime: trial.allSleepTime,
    settlePath: trial.settlePath,
    duration: trial.settleTime,
    firstBounceHeight,
    perDieDeltas: yDeltas,
  }
}

// ─── 多 seed 弹性感评估 ───────────────────────────────

function runMultiSeedBounceCheck(floorRestitution: number): { avgFirstBounce: number; maxFirstBounce: number } {
  const seeds = [42, 1, 7777, 12345, 99999, 314159, 65535, 271828, 5555, 666]
  let totalBounce = 0
  let maxBounce = 0

  for (const seed of seeds) {
    let firstContact = -1
    const earlyMinY = new Array(6).fill(Infinity)
    let seedMaxBounce = 0
    runTrial({
      seed,
      maxFrames: 300,
      floorRestitution,
      onFrame(frame, _time, bodies) {
        if (firstContact < 0 && bodies.every(b => b.position.y < 0.5)) firstContact = frame
        if (firstContact >= 0 && frame <= firstContact + 40) {
          for (let i = 0; i < 6; i++) {
            const y = bodies[i].position.y
            if (y < earlyMinY[i]) earlyMinY[i] = y
            const bounce = y - earlyMinY[i]
            if (bounce > seedMaxBounce) seedMaxBounce = bounce
          }
        }
      },
    })

    totalBounce += seedMaxBounce
    if (seedMaxBounce > maxBounce) maxBounce = seedMaxBounce
  }

  return { avgFirstBounce: totalBounce / seeds.length, maxFirstBounce: maxBounce }
}

// ─── Main ──────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════╗')
console.log('║        碗底 restitution sweep (seed=1776390018022)     ║')
console.log('╚══════════════════════════════════════════════════╝')
console.log(`墙面 restitution 固定 = ${PHYSICS.contact.diceWall.restitution}`)
console.log()

console.log('restit | maxYRise  | worst | broken | sleepT | settle  | duration | 1stBounce')
console.log('-------|-----------|-------|--------|--------|---------|----------|----------')

const results: { r: number; m: Metrics; bounce: { avgFirstBounce: number; maxFirstBounce: number } }[] = []

for (const r of RESTITUTION_VALUES) {
  const m = runThrow(r)
  const bounce = runMultiSeedBounceCheck(r)
  results.push({ r, m, bounce })

  console.log(
    `  ${r.toFixed(2)} | ${(m.maxYRise * 1000).toFixed(1).padStart(7)}mm | die${m.worstDie + 1}  | ${String(m.stableBroken).padStart(6)} | ${m.sleepTime >= 0 ? m.sleepTime.toFixed(2).padStart(5) + 's' : '  N/A '} | ${m.settlePath.padStart(7)} | ${m.duration.toFixed(2).padStart(7)}s | ${(m.firstBounceHeight * 1000).toFixed(1)}mm`
  )
}

console.log('\n═══ 多 seed 首次落碗弹性感（10 seeds）═══')
console.log('restit | avg 1st bounce | max 1st bounce | 观感评估')
console.log('-------|----------------|----------------|--------')
for (const { r, bounce } of results) {
  const avg = (bounce.avgFirstBounce * 1000).toFixed(1)
  const max = (bounce.maxFirstBounce * 1000).toFixed(1)
  const feel = bounce.avgFirstBounce < 0.005 ? '⚠️ 可能过死' :
               bounce.avgFirstBounce < 0.015 ? '✓ 适中' : '✓ 正常'
  console.log(`  ${r.toFixed(2)} | ${avg.padStart(12)}mm | ${max.padStart(12)}mm | ${feel}`)
}

console.log('\n═══ 每颗骰子 frame100+ Y delta 对比 (seed=1776390018022) ═══')
for (const { r, m } of results) {
  const deltas = m.perDieDeltas.map((d, i) => `die${i + 1}=${(d * 1000).toFixed(1)}mm`).join(', ')
  console.log(`  restit=${r.toFixed(2)}: ${deltas}`)
}

console.log('\n基线对照: BOX die3=3.0mm, die4=1.4mm, 其余<1mm')
