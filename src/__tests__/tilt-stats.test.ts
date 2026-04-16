/**
 * 倾斜率统计测试
 * 批量运行随机种子，收集倾斜骰子位置/角度 + settle 路径分布
 */
import { describe, it } from 'vitest'
import { createPhysicsWorld } from '@/physics/world'
import { createBowlBodies, ESCAPE_Y } from '@/physics/bowl-body'
import { setupContactMaterials } from '@/physics/materials'
import { createDiceBody } from '@/dice/dice-body'
import { PHYSICS } from '@/config/physics'
import { reseed } from '@/utils/random'
import { throwDice } from '@/dice/throw'
import { createSettleState } from '@/dice/settle'
import { readAllFacesDetailed } from '@/dice/read-face'
import { SETTLE } from '@/config/settle'
import { bowlInnerHeight } from '@/config/bowl'
import * as CANNON from 'cannon-es'

const NUM_TRIALS = 200
const MAX_FRAMES = 600 // 10 秒
const BASE_SEED = 42000

type SettlePath = 'sleep' | 'threshold' | 'timeout'

/** 与 settle.ts checkSettled 等价，但返回 settle 路径 */
function checkSettledWithPath(
  bodies: CANNON.Body[],
  currentTime: number,
  state: { startTime: number; stableStartTime: number },
): SettlePath | null {
  if (bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING)) return 'sleep'
  if (currentTime - state.startTime >= SETTLE.timeout) return 'timeout'
  const allBelow = bodies.every((b) =>
    b.velocity.length() < SETTLE.speedThreshold &&
    b.angularVelocity.length() < SETTLE.angularThreshold)
  if (allBelow) {
    if (state.stableStartTime < 0) state.stableStartTime = currentTime
    else if (currentTime - state.stableStartTime >= SETTLE.stableDuration) return 'threshold'
  } else {
    state.stableStartTime = -1
  }
  return null
}

describe('倾斜率统计', () => {
  it(`${NUM_TRIALS} 次投掷倾斜分析`, { timeout: 60000 }, () => {
    let totalDice = 0
    let tiltCount = 0
    let tiltRounds = 0
    const settlePaths: Record<SettlePath, number> = { sleep: 0, threshold: 0, timeout: 0 }
    const tiltData: Array<{
      seed: number
      dieIdx: number
      confidence: number
      angleDeg: number
      r: number
      y: number
      wallAngleDeg: number
      settlePath: SettlePath
    }> = []

    for (let trial = 0; trial < NUM_TRIALS; trial++) {
      const seed = BASE_SEED + trial * 1000
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

      const settleState = createSettleState(0)
      const dt = PHYSICS.fixedTimeStep
      let currentTime = 0
      let path: SettlePath = 'timeout'

      for (let i = 0; i < MAX_FRAMES; i++) {
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

      settlePaths[path]++
      const detailed = readAllFacesDetailed(bodies)
      totalDice += 6
      let roundHasTilt = false

      for (let i = 0; i < 6; i++) {
        const d = detailed[i]
        if (d.confidence < SETTLE.tiltThreshold) {
          tiltCount++
          roundHasTilt = true
          const b = bodies[i]
          const r = Math.sqrt(b.position.x ** 2 + b.position.z ** 2)
          const dr = 0.001
          const dh = bowlInnerHeight(r + dr) - bowlInnerHeight(r)
          const wallAngleDeg = Math.atan2(dh, dr) * (180 / Math.PI)

          tiltData.push({
            seed, dieIdx: i,
            confidence: d.confidence,
            angleDeg: Math.acos(Math.min(1, d.confidence)) * (180 / Math.PI),
            r, y: b.position.y, wallAngleDeg, settlePath: path,
          })
        }
      }
      if (roundHasTilt) tiltRounds++
      dispose()
    }

    // ── 输出统计报告 ──
    console.log(`\n${'='.repeat(60)}`)
    console.log(`  倾斜统计: ${NUM_TRIALS} 轮 / ${totalDice} 颗骰子`)
    console.log(`  倾斜骰子数: ${tiltCount} (${(tiltCount / totalDice * 100).toFixed(1)}%)`)
    console.log(`  含倾斜的轮数: ${tiltRounds} (${(tiltRounds / NUM_TRIALS * 100).toFixed(1)}%)`)
    console.log(`  倾斜阈值: cos(${(Math.acos(SETTLE.tiltThreshold) * 180 / Math.PI).toFixed(1)}°) = ${SETTLE.tiltThreshold}`)
    console.log(`  settle 路径: sleep=${settlePaths.sleep} threshold=${settlePaths.threshold} timeout=${settlePaths.timeout}`)
    console.log(`${'='.repeat(60)}`)

    if (tiltData.length > 0) {
      // settle 路径 × 倾斜交叉
      const tiltBySleep = tiltData.filter((d) => d.settlePath === 'sleep').length
      const tiltByThresh = tiltData.filter((d) => d.settlePath === 'threshold').length
      console.log(`\n  倾斜 × settle路径: sleep=${tiltBySleep} threshold=${tiltByThresh}`)

      // 按 r 分桶
      const rBuckets = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4]
      console.log('\n  倾斜骰子位置分布 (按 r 分桶):')
      for (let bi = 0; bi < rBuckets.length; bi++) {
        const lo = bi === 0 ? 0 : rBuckets[bi - 1]
        const hi = rBuckets[bi]
        const bucket = tiltData.filter((d) => d.r >= lo && d.r < hi)
        if (bucket.length > 0) {
          const avgAngle = bucket.reduce((s, d) => s + d.angleDeg, 0) / bucket.length
          const avgWall = bucket.reduce((s, d) => s + d.wallAngleDeg, 0) / bucket.length
          console.log(`    r=[${lo.toFixed(1)}, ${hi.toFixed(1)}): ${bucket.length} 颗, 平均倾斜 ${avgAngle.toFixed(1)}°, 碗壁坡度 ${avgWall.toFixed(1)}°`)
        }
      }

      // 倾斜角度分布
      console.log('\n  倾斜角度分布:')
      const angleBuckets = [42, 45, 50, 55, 60, 70, 80, 90]
      for (let bi = 0; bi < angleBuckets.length; bi++) {
        const lo = bi === 0 ? 41.4 : angleBuckets[bi - 1]
        const hi = angleBuckets[bi]
        const bucket = tiltData.filter((d) => d.angleDeg >= lo && d.angleDeg < hi)
        if (bucket.length > 0) console.log(`    [${lo.toFixed(0)}°, ${hi}°): ${bucket.length} 颗`)
      }

      // 前 20 个样本
      console.log('\n  倾斜样本 (前 20):')
      console.log('  seed          die  conf    angle   r      y      wall   path')
      for (const d of tiltData.slice(0, 20)) {
        console.log(
          `  ${String(d.seed).padEnd(14)} ${d.dieIdx + 1}    ${d.confidence.toFixed(3)}   ${d.angleDeg.toFixed(1).padStart(5)}°  ${d.r.toFixed(3)}  ${d.y.toFixed(3)}  ${d.wallAngleDeg.toFixed(1).padStart(5)}°  ${d.settlePath}`,
        )
      }
    }
  })
})
