/**
 * 快速验证测试（从 review-verify 中提取的非耗时部分）
 * - 高度分层检查
 * - fallback 拓扑覆盖
 * - 关键种子复现
 */
import { describe, it, expect } from 'vitest'
import { createPhysicsWorld } from '@/physics/world'
import { createBowlBodies, ESCAPE_Y } from '@/physics/bowl-body'
import { setupContactMaterials } from '@/physics/materials'
import { createDiceBody } from '@/dice/dice-body'
import type { DicePair } from '@/dice/create'
import { checkSettled, createSettleState } from '@/dice/settle'
import { PHYSICS } from '@/config/physics'
import { SETTLE } from '@/config/settle'
import { THROW } from '@/config/throw'
import { reseed } from '@/utils/random'
import { throwDice } from '@/dice/throw'
import { readAllFacesDetailed } from '@/dice/read-face'
import * as CANNON from 'cannon-es'

type SettlePath = 'sleep' | 'threshold' | 'timeout'

function classifySettlePath(
  bodies: CANNON.Body[],
  currentTime: number,
  startTime: number,
): SettlePath {
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
    return { mesh: {} as DicePair['mesh'], body }
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
  const tilts = detailed
    .map((d, i) => ({ ...d, idx: i }))
    .filter((d) => d.confidence < SETTLE.tiltThreshold)

  dispose()
  return { path, settleTime: currentTime, detailed, tilts }
}

// ═══════════════════════════════════════════════════════════
// 高度分层验证
// ═══════════════════════════════════════════════════════════
describe('高度分层验证', () => {
  it('确认 fallback 布局骰子高度是否分层', () => {
    const heightSets: number[][] = []
    for (let trial = 0; trial < 100; trial++) {
      reseed(70000 + trial * 100)
      const { world, dispose } = createPhysicsWorld()
      setupContactMaterials(world)
      createBowlBodies(world)

      const dicePairs = Array.from({ length: 6 }, () => {
        const body = createDiceBody()
        world.addBody(body)
        return { mesh: {} as DicePair['mesh'], body }
      })
      throwDice(dicePairs)
      heightSets.push(dicePairs.map((p) => p.body.position.y))
      dispose()
    }

    let hasLayeredRound = false
    for (const heights of heightSets) {
      const sorted = [...heights].sort((a, b) => a - b)
      const range = sorted[5] - sorted[0]
      const gaps = sorted.slice(1).map((h, i) => h - sorted[i])
      const maxGap = Math.max(...gaps)
      if (maxGap > range * 0.5 && range > 0.1) {
        hasLayeredRound = true
        break
      }
    }

    console.log(`  heightMin=${THROW.heightMin} heightMax=${THROW.heightMax}`)
    console.log(`  100 轮中检测到分层: ${hasLayeredRound ? '是' : '否'}`)
  })
})

// ═══════════════════════════════════════════════════════════
// fallback 拓扑覆盖
// ═══════════════════════════════════════════════════════════
describe('fallback 拓扑覆盖', () => {
  it('1000 次 fallback 触发时 3 种拓扑都被覆盖', () => {
    let ring6Count = 0
    let dual33Count = 0
    let center15Count = 0

    for (let trial = 0; trial < 1000; trial++) {
      reseed(80000 + trial * 7)
      const { world, dispose } = createPhysicsWorld()
      setupContactMaterials(world)
      createBowlBodies(world)

      const dicePairs = Array.from({ length: 6 }, () => {
        const body = createDiceBody()
        world.addBody(body)
        return { mesh: {} as DicePair['mesh'], body }
      })
      // 这项历史契约只验证 legacy-v1 fallback 的三种拓扑。
      // 使用真实 diagnostics，避免从构造式/新默认路径的位置反推布局而产生假阳性。
      const diagnostics = throwDice(dicePairs, { algorithm: 'legacy-v1' })
      if (diagnostics.placementPath === 'fallback') {
        if (diagnostics.fallbackLayout === 'ring6') ring6Count++
        else if (diagnostics.fallbackLayout === 'dual33') dual33Count++
        else if (diagnostics.fallbackLayout === 'center15') center15Count++
      }

      dispose()
    }

    expect(ring6Count, 'ring6 从未被选中').toBeGreaterThan(0)
    expect(dual33Count, 'dual33 从未被选中').toBeGreaterThan(0)
    expect(center15Count, 'center15 从未被选中').toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════
// 关键种子复现
// ═══════════════════════════════════════════════════════════
describe('关键种子复现', () => {
  const slowSeeds = [1776308075747, 1776308125213, 1776308167330, 1776308186180, 1776308201964]
  const tiltSeed = 1776308150130

  for (const seed of slowSeeds) {
    it(`慢结算种子 ${seed}`, { timeout: 30_000 }, () => {
      const { path, settleTime, tilts } = runTrial(seed)
      console.log(
        `  seed=${seed} path=${path} time=${settleTime.toFixed(2)}s tilts=${tilts.length}`,
      )
    })
  }

  it(`莫名倾角种子 ${tiltSeed}`, { timeout: 30_000 }, () => {
    const { path, settleTime, tilts, detailed } = runTrial(tiltSeed)
    console.log(
      `  seed=${tiltSeed} path=${path} time=${settleTime.toFixed(2)}s tilts=${tilts.length}`,
    )
    for (const d of detailed) {
      const angle = Math.acos(Math.min(1, d.confidence)) * (180 / Math.PI)
      console.log(
        `    die${detailed.indexOf(d) + 1}: value=${d.value} conf=${d.confidence.toFixed(3)} angle=${angle.toFixed(1)}°`,
      )
    }
  })
})
