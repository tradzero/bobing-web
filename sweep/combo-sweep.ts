/**
 * 组合测试：最佳 restitution + 最佳 chamferRatio
 * 以及 box 对照的完整对比
 */
import { runTrial } from './lib/run-trial'

const SEEDS = [
  1776390018022, 42, 1, 7777, 12345, 99999, 314159, 65535,
  271828, 5555, 666, 11111, 54321, 777777, 31337, 13,
  9999999, 123456789, 2024, 8888,
]

interface Config {
  label: string
  chamferRatio: number
  floorRestitution: number
}

const CONFIGS: Config[] = [
  { label: 'baseline (cr=0.15, r=0.15)', chamferRatio: 0.15, floorRestitution: 0.15 },
  { label: 'cr=0.15, r=0.08', chamferRatio: 0.15, floorRestitution: 0.08 },
  { label: 'cr=0.12, r=0.15', chamferRatio: 0.12, floorRestitution: 0.15 },
  { label: 'cr=0.12, r=0.08', chamferRatio: 0.12, floorRestitution: 0.08 },
  { label: 'cr=0.12, r=0.05', chamferRatio: 0.12, floorRestitution: 0.05 },
  { label: 'box (对照)', chamferRatio: 0, floorRestitution: 0.15 },
]

function runSeed(seed: number, cfg: Config) {
  const post100MinY = new Array(6).fill(Infinity)
  const post100MaxY = new Array(6).fill(-Infinity)
  const shapeMode = cfg.chamferRatio > 0 ? 'chamfer' : 'box'
  const trial = runTrial({
    seed,
    maxFrames: 1200,
    shapeMode,
    chamferRatio: cfg.chamferRatio,
    floorRestitution: cfg.floorRestitution,
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

console.log('╔══════════════════════════════════════════════════╗')
console.log('║       组合 sweep (20 seeds)                        ║')
console.log('╚══════════════════════════════════════════════════╝\n')

console.log('config                       | bounce% | median  | p90     | max     | avgSleep | avgBrk | tilt')
console.log('-----------------------------|---------|---------|---------|---------|----------|--------|-----')

for (const cfg of CONFIGS) {
  const results = SEEDS.map(seed => runSeed(seed, cfg))
  const rises = results.map(r => r.maxYRise)
  const bounceCount = rises.filter(y => y > 0.01).length
  const sorted = [...rises].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const p90 = sorted[Math.floor(sorted.length * 0.9)]
  const max = sorted[sorted.length - 1]
  const sleepValues = results.map(r => r.sleepTime).filter(t => t >= 0)
  const avgSleep = sleepValues.length > 0 ? sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length : -1
  const avgBroken = results.reduce((sum, r) => sum + r.stableBroken, 0) / results.length
  const tilts = results.reduce((sum, r) => sum + r.tiltCount, 0)
  const sleepLabel = avgSleep >= 0 ? `${avgSleep.toFixed(2).padStart(7)}s` : '   N/A '

  console.log(
    `${cfg.label.padEnd(29)}| ${String(Math.round(bounceCount/SEEDS.length*100)).padStart(5)}%  | ${(median * 1000).toFixed(1).padStart(6)}mm | ${(p90 * 1000).toFixed(1).padStart(6)}mm | ${(max * 1000).toFixed(1).padStart(6)}mm | ${sleepLabel} | ${avgBroken.toFixed(1).padStart(5)}  | ${tilts}/${SEEDS.length * 6}`
  )
}
