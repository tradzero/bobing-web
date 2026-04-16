/**
 * diceDice friction + restitution 对比 sweep
 * 500 seed 统一口径 + 6 个关键 seed
 */
import { describe, it } from 'vitest'
import { createPhysicsWorld } from '@/physics/world'
import { createBowlBodies, ESCAPE_Y } from '@/physics/bowl-body'
import { setupContactMaterials } from '@/physics/materials'
import { createDiceBody } from '@/dice/dice-body'
import { PHYSICS } from '@/config/physics'
import { SETTLE } from '@/config/settle'
import { reseed } from '@/utils/random'
import { throwDice } from '@/dice/throw'
import { readAllFacesDetailed } from '@/dice/read-face'
import * as CANNON from 'cannon-es'

interface Variant {
  label: string
  friction: number
  restitution: number
}

const VARIANTS: Variant[] = [
  { label: 'baseline (f=0.30 r=0.25)', friction: 0.30, restitution: 0.25 },
  { label: 'f=0.22 only', friction: 0.22, restitution: 0.25 },
  { label: 'r=0.20 only', friction: 0.30, restitution: 0.20 },
  { label: 'f=0.27 r=0.20', friction: 0.27, restitution: 0.20 },
  { label: 'f=0.25 r=0.20', friction: 0.25, restitution: 0.20 },
]

interface TrialResult {
  path: string
  settleTime: number
  tiltCount: number
  maxTiltAngle: number
}

function runTrial(seed: number, v: Variant): TrialResult {
  reseed(seed)
  const { world, step, dispose } = createPhysicsWorld()
  setupContactMaterials(world)

  // 覆盖 dice-dice ContactMaterial 参数
  for (const cm of world.contactmaterials) {
    const mats = (cm as any).materials as CANNON.Material[] | undefined
    const nameA = mats?.[0]?.name ?? (cm as any).materialA?.name
    const nameB = mats?.[1]?.name ?? (cm as any).materialB?.name
    if (nameA === 'dice' && nameB === 'dice') {
      cm.friction = v.friction
      cm.restitution = v.restitution
    }
  }

  createBowlBodies(world)
  const dicePairs = Array.from({ length: 6 }, () => {
    const body = createDiceBody()
    world.addBody(body)
    return { mesh: {} as any, body }
  })
  throwDice(dicePairs)
  const bodies = dicePairs.map(p => p.body)

  const dt = PHYSICS.fixedTimeStep
  let t = 0
  let path = 'timeout'
  const stableState = { stableStartTime: -1 }

  for (let i = 0; i < 800; i++) {
    step(dt); t += dt
    for (const { body } of dicePairs) {
      if (body.position.y > ESCAPE_Y && body.velocity.y > 0) body.velocity.y = -body.velocity.y * 0.3
    }
    if (bodies.every(b => b.sleepState === CANNON.Body.SLEEPING)) { path = 'sleep'; break }
    if (t >= SETTLE.timeout) break
    const allBelow = bodies.every(b =>
      b.velocity.length() < SETTLE.speedThreshold &&
      b.angularVelocity.length() < SETTLE.angularThreshold)
    if (allBelow) {
      if (stableState.stableStartTime < 0) stableState.stableStartTime = t
      else if (t - stableState.stableStartTime >= SETTLE.stableDuration) { path = 'threshold'; break }
    } else { stableState.stableStartTime = -1 }
  }

  const detailed = readAllFacesDetailed(bodies)
  let tiltCount = 0, maxTiltAngle = 0
  for (const d of detailed) {
    if (d.confidence < SETTLE.tiltThreshold) {
      tiltCount++
      const angle = Math.acos(Math.min(1, d.confidence)) * 180 / Math.PI
      if (angle > maxTiltAngle) maxTiltAngle = angle
    }
  }
  dispose()
  return { path, settleTime: t, tiltCount, maxTiltAngle }
}

const N = 500
const BASE_SEED = 50000
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

describe('diceDice param sweep', () => {
  for (const v of VARIANTS) {
    it(`${v.label}: 500轮 + 特殊seed`, { timeout: 180_000 }, () => {
      let tiltDice = 0, tiltRounds = 0, timeoutCount = 0
      const times: number[] = []

      for (let i = 0; i < N; i++) {
        const seed = BASE_SEED + i * 1000
        const r = runTrial(seed, v)
        times.push(r.settleTime)
        tiltDice += r.tiltCount
        if (r.tiltCount > 0) tiltRounds++
        if (r.path === 'timeout') timeoutCount++
      }

      times.sort((a, b) => a - b)
      const avg = times.reduce((s, t) => s + t, 0) / N
      const p95 = times[Math.floor(N * 0.95)]
      const over5 = times.filter(t => t > 5).length
      const over7 = times.filter(t => t > 7).length

      console.log(`\n=== ${v.label} ===`)
      console.log(`  500-seed: tiltDice=${tiltDice} tiltRounds=${tiltRounds} timeout=${timeoutCount}`)
      console.log(`  time: avg=${avg.toFixed(2)}s p95=${p95.toFixed(2)}s >5s=${over5} >7s=${over7}`)

      // 特殊 seed
      for (const { seed, desc } of SPECIAL_SEEDS) {
        const r = runTrial(seed, v)
        const tiltFlag = r.tiltCount > 0 ? ' ⚠TILT' : ''
        console.log(`  ${desc}(${seed}): ${r.settleTime.toFixed(2)}s max=${r.maxTiltAngle.toFixed(1)}° tilts=${r.tiltCount}${tiltFlag}`)
      }
    })
  }
})
