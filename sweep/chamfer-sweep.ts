/**
 * chamferRatio sweep
 *
 * 对比 0.15（当前）/ 0.12 / 0.10 / 0（box 对照）
 * chamferRatio=0 仅作对照项，不作为默认候选修复
 *
 * 目标：确认当前弹跳问题是否本质上只能靠降低倒角比例解决
 */
import { PHYSICS } from '@/config/physics'
import { runTrial } from './lib/run-trial'

const CHAMFER_RATIOS = [0.15, 0.12, 0.10, 0] // 0 = box 对照
const SEEDS = [
  1776390018022, 42, 1, 7777, 12345, 99999, 314159, 65535,
  271828, 5555, 666, 11111, 54321, 777777, 31337, 13,
  9999999, 123456789, 2024, 8888,
]

interface SeedResult {
  maxYRise: number
  stableBroken: number
  sleepTime: number
  tiltCount: number
}

function runSeed(seed: number, chamferRatio: number): SeedResult {
  const post100MinY = new Array(6).fill(Infinity)
  const post100MaxY = new Array(6).fill(-Infinity)
  const shapeMode = chamferRatio > 0 ? 'chamfer' : 'box'
  const trial = runTrial({
    seed,
    maxFrames: 1200,
    shapeMode,
    chamferRatio,
    onFrame(frame, _time, bodies) {
      if (frame < 100) return
      for (let i = 0; i < 6; i++) {
        const y = bodies[i].position.y
        if (y < post100MinY[i]) post100MinY[i] = y
        if (y > post100MaxY[i]) post100MaxY[i] = y
      }
    },
  })

  const yDeltas = post100MaxY.map((max, i) => max - post100MinY[i])

  return {
    maxYRise: Math.max(...yDeltas),
    stableBroken: trial.stableBrokenCount,
    sleepTime: trial.allSleepTime,
    tiltCount: trial.tiltCount,
  }
}

// ─── Main ──────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════╗')
console.log('║       chamferRatio sweep (20 seeds)                ║')
console.log('╚══════════════════════════════════════════════════╝\n')

for (const cr of CHAMFER_RATIOS) {
  const label = cr === 0 ? 'box (对照)' : `chamfer=${cr}`
  const hs = PHYSICS.diceHalfSize
  const chamferSize = hs * cr
  const triEdge = chamferSize * Math.sqrt(2)

  console.log(`\n═══ ${label}  chamfer=${chamferSize.toFixed(4)}m  三角面边≈${triEdge.toFixed(4)}m ═══`)

  const results = SEEDS.map(seed => runSeed(seed, cr))
  const rises = results.map(r => r.maxYRise)
  const brokens = results.map(r => r.stableBroken)
  const sleeps = results.map(r => r.sleepTime).filter(t => t >= 0)
  const tilts = results.reduce((sum, r) => sum + r.tiltCount, 0)

  const bounceCount = rises.filter(y => y > 0.01).length
  const sorted = [...rises].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const p90 = sorted[Math.floor(sorted.length * 0.9)]
  const max = sorted[sorted.length - 1]
  const avgSleep = sleeps.reduce((a, b) => a + b, 0) / sleeps.length
  const avgBroken = brokens.reduce((a, b) => a + b, 0) / brokens.length

  console.log(`  明显弹跳(>10mm): ${bounceCount}/${SEEDS.length} (${(bounceCount/SEEDS.length*100).toFixed(0)}%)`)
  console.log(`  maxYRise: median=${(median * 1000).toFixed(1)}mm, p90=${(p90 * 1000).toFixed(1)}mm, max=${(max * 1000).toFixed(1)}mm`)
  console.log(`  avg sleepTime: ${avgSleep.toFixed(2)}s`)
  console.log(`  avg stableBroken: ${avgBroken.toFixed(1)}`)
  console.log(`  tilt 总数: ${tilts}/${SEEDS.length * 6} dice`)
  console.log(`  逐 seed maxYRise: ${rises.map(y => (y * 1000).toFixed(0) + 'mm').join(', ')}`)
}
