/**
 * 慢结算种子行为回归
 * 5 个已知慢结算种子不得走 timeout 路径，且结算时间不超过上限
 * 1776308150130（已知斜停）暂只做诊断输出，不加硬断言
 */
import { describe, it, expect } from 'vitest'
import { createPhysicsWorld } from '@/physics/world'
import { createBowlBodies, ESCAPE_Y } from '@/physics/bowl-body'
import { setupContactMaterials } from '@/physics/materials'
import { createDiceBody } from '@/dice/dice-body'
import { checkSettled, createSettleState } from '@/dice/settle'
import { PHYSICS } from '@/config/physics'
import { SETTLE } from '@/config/settle'
import { reseed } from '@/utils/random'
import { throwDice } from '@/dice/throw'
import { readAllFacesDetailed } from '@/dice/read-face'
import * as CANNON from 'cannon-es'

type SettlePath = 'sleep' | 'threshold' | 'timeout'

function classifySettlePath(bodies: CANNON.Body[], currentTime: number, startTime: number): SettlePath {
  if (bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING)) return 'sleep'
  if (currentTime - startTime >= SETTLE.timeout) return 'timeout'
  return 'threshold'
}

function runTrial(seed: number) {
  reseed(seed)
  const { world, step, dispose } = createPhysicsWorld()
  setupContactMaterials(world)
  createBowlBodies(world)

  const dicePairs = Array.from({ length: 6 }, () => {
    const body = createDiceBody()
    world.addBody(body)
    return { mesh: {} as any, body }
  })
  throwDice(dicePairs)
  const bodies = dicePairs.map((p) => p.body)

  const dt = PHYSICS.fixedTimeStep
  const maxFrames = 800
  let currentTime = 0
  let path: SettlePath = 'timeout'
  const settleState = createSettleState(0)

  for (let i = 0; i < maxFrames; i++) {
    step(dt)
    currentTime += dt
    for (const { body } of dicePairs) {
      if (body.position.y > ESCAPE_Y && body.velocity.y > 0) {
        body.velocity.y = -body.velocity.y * 0.3
      }
    }
    if (checkSettled(bodies, currentTime, settleState, world)) {
      path = classifySettlePath(bodies, currentTime, settleState.startTime)
      break
    }
  }

  const detailed = readAllFacesDetailed(bodies)
  dispose()
  return { path, settleTime: currentTime, detailed }
}

/** 结算时间上限 (s)，基于 sweep 数据的 p95 设定 */
const SETTLE_TIME_LIMIT = 8.0

const SLOW_SEEDS = [
  1776308075747,
  1776308125213,
  1776308167330,
  1776308186180,
  1776308201964,
]

describe('慢结算种子行为回归', () => {
  for (const seed of SLOW_SEEDS) {
    it(`seed ${seed}: 不超时且结算时间 < ${SETTLE_TIME_LIMIT}s`, () => {
      const { path, settleTime } = runTrial(seed)
      console.log(`  ${seed}: path=${path} time=${settleTime.toFixed(2)}s`)
      expect(path, `seed ${seed} 走了 timeout 路径`).not.toBe('timeout')
      expect(settleTime, `seed ${seed} 结算时间 ${settleTime.toFixed(2)}s 超过上限`).toBeLessThan(SETTLE_TIME_LIMIT)
    })
  }
})

describe('已知斜停种子诊断（暂无硬断言）', () => {
  it('1776308150130: 诊断输出', () => {
    const { path, settleTime, detailed } = runTrial(1776308150130)
    const tilts = detailed.filter((d) => d.confidence < SETTLE.tiltThreshold)
    console.log(`  1776308150130: path=${path} time=${settleTime.toFixed(2)}s tilts=${tilts.length}`)
    for (const d of detailed) {
      const angle = Math.acos(Math.min(1, d.confidence)) * (180 / Math.PI)
      console.log(`    value=${d.value} conf=${d.confidence.toFixed(3)} angle=${angle.toFixed(1)}°`)
    }
  })
})
