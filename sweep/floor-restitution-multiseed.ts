/**
 * 碗底 restitution 多 seed 稳定性验证
 * 对 0.15 / 0.08 / 0.05 / 0.02 四档各跑 20 个 seed，
 * 统计 frame100+ 最大 Y 回升的分布
 */
import { runTrial } from './lib/run-trial'

const RESTITUTION_VALUES = [0.15, 0.08, 0.05, 0.02]
const SEEDS = [
  1776390018022, 42, 1, 7777, 12345, 99999, 314159, 65535,
  271828, 5555, 666, 11111, 54321, 777777, 31337, 13,
  9999999, 123456789, 2024, 8888,
]

function runSeed(seed: number, floorRestitution: number): { maxYRise: number; sleepTime: number; stableBroken: number } {
  const post100MinY = new Array(6).fill(Infinity)
  const post100MaxY = new Array(6).fill(-Infinity)
  const trial = runTrial({
    seed,
    maxFrames: 1200,
    floorRestitution,
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
    sleepTime: trial.allSleepTime,
    stableBroken: trial.stableBrokenCount,
  }
}

console.log('╔══════════════════════════════════════════════════╗')
console.log('║   碗底 restitution 多 seed 稳定性验证 (20 seeds)     ║')
console.log('╚══════════════════════════════════════════════════╝\n')

for (const r of RESTITUTION_VALUES) {
  const results = SEEDS.map(seed => runSeed(seed, r))
  const rises = results.map(r => r.maxYRise)
  const sleeps = results.map(r => r.sleepTime).filter(t => t >= 0)
  const brokens = results.map(r => r.stableBroken)
  const bounceCount = rises.filter(y => y > 0.01).length  // >10mm 算明显弹跳

  const sorted = [...rises].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const p90 = sorted[Math.floor(sorted.length * 0.9)]
  const max = sorted[sorted.length - 1]
  const avgSleep = sleeps.length > 0 ? sleeps.reduce((a, b) => a + b, 0) / sleeps.length : -1
  const avgBroken = brokens.reduce((a, b) => a + b, 0) / brokens.length

  console.log(`═══ restit=${r.toFixed(2)} ═══`)
  console.log(`  明显弹跳(>10mm): ${bounceCount}/${SEEDS.length} seeds (${(bounceCount/SEEDS.length*100).toFixed(0)}%)`)
  console.log(`  maxYRise: median=${(median * 1000).toFixed(1)}mm, p90=${(p90 * 1000).toFixed(1)}mm, max=${(max * 1000).toFixed(1)}mm`)
  console.log(`  avg sleepTime: ${avgSleep >= 0 ? avgSleep.toFixed(2) + 's' : 'N/A'}`)
  console.log(`  avg stableBroken: ${avgBroken.toFixed(1)}`)
  console.log(`  逐 seed maxYRise: ${rises.map(y => (y * 1000).toFixed(0) + 'mm').join(', ')}`)
  console.log()
}
