/**
 * Box + 当前阻尼(0.35/0.35) tilt 和弹跳大规模验证
 * 200 seeds，确认 box 在当前参数下是否仍有 tilt 风险
 */
import { PHYSICS } from '@/config/physics'
import { runTrial } from './lib/run-trial'

const SEED_COUNT = 200
const BASE_SEED = 42

function runSeed(seed: number) {
  const post100MinY = new Array(6).fill(Infinity)
  const post100MaxY = new Array(6).fill(-Infinity)
  const trial = runTrial({
    seed,
    maxFrames: 1200,
    shapeMode: 'box',
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
    settlePath: trial.settlePath,
  }
}

console.log('╔══════════════════════════════════════════════════╗')
console.log('║  Box + 当前阻尼 大规模验证 (200 seeds)             ║')
console.log('╚══════════════════════════════════════════════════╝')
console.log(`damping=${PHYSICS.diceLinearDamping}/${PHYSICS.diceAngularDamping}`)
console.log(`sleepSpeed=${PHYSICS.diceSleepSpeedLimit}, sleepTime=${PHYSICS.diceSleepTimeLimit}`)
console.log()

let totalTilt = 0
let totalBounce = 0
let totalTimeout = 0
const allRises: number[] = []
const allSleepTimes: number[] = []
const allBrokens: number[] = []
const tiltSeeds: number[] = []
const bounceSeeds: { seed: number; rise: number }[] = []

for (let i = 0; i < SEED_COUNT; i++) {
  const seed = BASE_SEED + i * 1000
  const r = runSeed(seed)

  totalTilt += r.tiltCount
  allRises.push(r.maxYRise)
  allBrokens.push(r.stableBroken)
  if (r.sleepTime >= 0) allSleepTimes.push(r.sleepTime)
  if (r.settlePath === 'timeout') totalTimeout++
  if (r.maxYRise > 0.01) {
    totalBounce++
    bounceSeeds.push({ seed, rise: r.maxYRise })
  }
  if (r.tiltCount > 0) tiltSeeds.push(seed)
}

const sortedRises = [...allRises].sort((a, b) => a - b)
const median = sortedRises[Math.floor(sortedRises.length / 2)]
const p90 = sortedRises[Math.floor(sortedRises.length * 0.9)]
const p95 = sortedRises[Math.floor(sortedRises.length * 0.95)]
const max = sortedRises[sortedRises.length - 1]
const avgSleep = allSleepTimes.reduce((a, b) => a + b, 0) / allSleepTimes.length
const avgBroken = allBrokens.reduce((a, b) => a + b, 0) / allBrokens.length

console.log(`═══ 总结 (${SEED_COUNT} seeds, ${SEED_COUNT * 6} dice) ═══`)
console.log(`  Tilt: ${totalTilt}/${SEED_COUNT * 6} dice (${(totalTilt / (SEED_COUNT * 6) * 100).toFixed(2)}%)`)
console.log(`  Tilt seeds: ${tiltSeeds.length > 0 ? tiltSeeds.join(', ') : '无'}`)
console.log(`  弹跳(>10mm): ${totalBounce}/${SEED_COUNT} seeds (${(totalBounce / SEED_COUNT * 100).toFixed(1)}%)`)
console.log(`  Timeout: ${totalTimeout}/${SEED_COUNT} (${(totalTimeout / SEED_COUNT * 100).toFixed(1)}%)`)
console.log(`  maxYRise: median=${(median * 1000).toFixed(1)}mm, p90=${(p90 * 1000).toFixed(1)}mm, p95=${(p95 * 1000).toFixed(1)}mm, max=${(max * 1000).toFixed(1)}mm`)
console.log(`  avg sleepTime: ${avgSleep.toFixed(2)}s`)
console.log(`  avg stableBroken: ${avgBroken.toFixed(1)}`)

if (bounceSeeds.length > 0) {
  const top5 = bounceSeeds.sort((a, b) => b.rise - a.rise).slice(0, 5)
  console.log(`  最严重弹跳 seeds: ${top5.map(s => `${s.seed}(${(s.rise * 1000).toFixed(0)}mm)`).join(', ')}`)
}
