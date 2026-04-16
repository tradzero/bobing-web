/**
 * diceSleepTimeLimit 三点 sweep: 0.32 / 0.30 / 0.28
 * 同一批 500 种子，统一口径比较
 * 指标：timeout 数量、p95、>5s 轮数、5 个慢结算种子时间、1776308150130 倾角
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

type SettlePath = 'sleep' | 'threshold' | 'timeout'

function checkSettledWithPath(
  bodies: CANNON.Body[],
  currentTime: number,
  state: { startTime: number; stableStartTime: number },
): SettlePath | null {
  if (bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING)) return 'sleep'
  if (currentTime - state.startTime >= SETTLE.timeout) return 'timeout'
  const allBelow = bodies.every(
    (b) =>
      b.velocity.length() < SETTLE.speedThreshold &&
      b.angularVelocity.length() < SETTLE.angularThreshold,
  )
  if (allBelow) {
    if (state.stableStartTime < 0) state.stableStartTime = currentTime
    else if (currentTime - state.stableStartTime >= SETTLE.stableDuration) return 'threshold'
  } else {
    state.stableStartTime = -1
  }
  return null
}

interface TrialResult {
  path: SettlePath
  settleTime: number
  tiltCount: number
  maxTiltAngle: number
}

function runTrial(
  seed: number,
  sleepTimeLimit: number,
): TrialResult {
  reseed(seed)
  const { world, step, dispose } = createPhysicsWorld()
  setupContactMaterials(world)
  createBowlBodies(world)

  const dicePairs = Array.from({ length: 6 }, () => {
    const body = createDiceBody()
    body.sleepTimeLimit = sleepTimeLimit // 使用 sweep 传入的值
    world.addBody(body)
    return { mesh: {} as any, body }
  })
  throwDice(dicePairs)
  const bodies = dicePairs.map((p) => p.body)

  const dt = PHYSICS.fixedTimeStep
  const maxFrames = 800
  let currentTime = 0
  let path: SettlePath = 'timeout'
  const settleState = { startTime: 0, stableStartTime: -1 }

  for (let i = 0; i < maxFrames; i++) {
    step(dt)
    currentTime += dt
    for (const { body } of dicePairs) {
      if (body.position.y > ESCAPE_Y && body.velocity.y > 0) {
        body.velocity.y = -body.velocity.y * 0.3
      }
    }
    const result = checkSettledWithPath(bodies, currentTime, settleState)
    if (result) { path = result; break }
  }

  const detailed = readAllFacesDetailed(bodies)
  let tiltCount = 0
  let maxTiltAngle = 0
  for (const d of detailed) {
    if (d.confidence < SETTLE.tiltThreshold) {
      tiltCount++
      const angle = Math.acos(Math.min(1, d.confidence)) * (180 / Math.PI)
      if (angle > maxTiltAngle) maxTiltAngle = angle
    }
  }

  dispose()
  return { path, settleTime: currentTime, tiltCount, maxTiltAngle }
}

const N = 500
const BASE_SEED = 50000

// 5 个慢结算种子 + 1 个倾斜种子
const SLOW_SEEDS = [1776308075747, 1776308125213, 1776308167330, 1776308186180, 1776308201964]
const TILT_SEED = 1776308150130

const SWEEP_VALUES = [0.32, 0.30, 0.28] as const

describe('diceSleepTimeLimit sweep', () => {
  for (const stl of SWEEP_VALUES) {
    it(`sleepTimeLimit=${stl}: 500 轮 + 特殊种子`, { timeout: 180_000 }, () => {
      const paths: Record<SettlePath, number> = { sleep: 0, threshold: 0, timeout: 0 }
      const times: number[] = []
      let tiltDice = 0
      let tiltRounds = 0

      // 500 轮统计
      for (let i = 0; i < N; i++) {
        const seed = BASE_SEED + i * 1000
        const r = runTrial(seed, stl)
        paths[r.path]++
        times.push(r.settleTime)
        tiltDice += r.tiltCount
        if (r.tiltCount > 0) tiltRounds++
      }

      times.sort((a, b) => a - b)
      const avg = times.reduce((s, t) => s + t, 0) / N
      const p50 = times[Math.floor(N * 0.5)]
      const p90 = times[Math.floor(N * 0.9)]
      const p95 = times[Math.floor(N * 0.95)]
      const over5s = times.filter((t) => t > 5).length

      // 5 个慢结算种子
      const slowResults = SLOW_SEEDS.map((s) => ({
        seed: s,
        ...runTrial(s, stl),
      }))

      // 倾斜种子
      const tiltResult = runTrial(TILT_SEED, stl)

      console.log(`\n${'='.repeat(65)}`)
      console.log(`  sleepTimeLimit = ${stl}`)
      console.log(`  settle: sleep=${paths.sleep} threshold=${paths.threshold} timeout=${paths.timeout}`)
      console.log(`  倾斜: ${tiltDice}/${N * 6} 颗 (${(tiltDice / (N * 6) * 100).toFixed(1)}%), ${tiltRounds}/${N} 轮`)
      console.log(`  时间: avg=${avg.toFixed(2)}s p50=${p50.toFixed(2)}s p90=${p90.toFixed(2)}s p95=${p95.toFixed(2)}s`)
      console.log(`  >5s: ${over5s} (${(over5s / N * 100).toFixed(1)}%)`)
      console.log(`  ── 慢结算种子 ──`)
      for (const r of slowResults) {
        console.log(`    ${r.seed}: ${r.path} ${r.settleTime.toFixed(2)}s tilts=${r.tiltCount}`)
      }
      console.log(`  ── 倾斜种子 ${TILT_SEED} ──`)
      console.log(`    path=${tiltResult.path} time=${tiltResult.settleTime.toFixed(2)}s tilts=${tiltResult.tiltCount} maxAngle=${tiltResult.maxTiltAngle.toFixed(1)}°`)
      console.log(`${'='.repeat(65)}`)
    })
  }
})
