/**
 * 种子复现工具：用指定种子模拟完整投掷 → 停稳 → 读数流程
 * 输出骰子终态位置、速度、倾斜角、是否飞出碗等诊断数据
 *
 * 用法: pnpm test -- --run -t "复现种子"
 * 修改下方 SEEDS 数组添加需要复现的种子
 */
import { describe, it } from 'vitest'
import { createPhysicsWorld } from '@/physics/world'
import { createBowlBodies, ESCAPE_Y, BOWL_RADIUS } from '@/physics/bowl-body'
import { BOWL_HEIGHT } from '@/config/bowl'
import { setupContactMaterials, diceMaterial } from '@/physics/materials'
import { PHYSICS } from '@/config/physics'
import { reseed } from '@/utils/random'
import { throwDice } from '@/dice/throw'
import { checkSettled, createSettleState } from '@/dice/settle'
import { readAllFacesDetailed } from '@/dice/read-face'
import { judge } from '@/rules/judge'
import { SETTLE } from '@/config/settle'
import * as CANNON from 'cannon-es'

// ====== 在这里添加需要复现的种子 ======
const SEEDS = [1776219009201]

const MAX_FRAMES = 3000

describe('复现种子', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}`, () => {
      reseed(seed)

      const { world, step, dispose } = createPhysicsWorld()
      setupContactMaterials(world)
      createBowlBodies(world)

      // 创建骰子 body（与运行时 create.ts 同构）并使用批量投掷路径（含去重）
      const hs = PHYSICS.diceHalfSize
      const dicePairs = Array.from({ length: 6 }, () => {
        const body = new CANNON.Body({
          mass: PHYSICS.diceMass,
          material: diceMaterial,
          linearDamping: PHYSICS.diceLinearDamping,
          angularDamping: PHYSICS.diceAngularDamping,
          allowSleep: true,
          sleepSpeedLimit: PHYSICS.diceSleepSpeedLimit,
          sleepTimeLimit: PHYSICS.diceSleepTimeLimit,
        })
        body.addShape(new CANNON.Box(new CANNON.Vec3(hs, hs, hs)))
        world.addBody(body)
        return { mesh: {} as any, body }
      })
      throwDice(dicePairs)
      const bodies = dicePairs.map((p) => p.body)

      // 记录模拟过程中的极值
      const peakY = new Array(6).fill(0)
      const peakXZ = new Array(6).fill(0)
      const escapeCount = new Array(6).fill(0)

      const settleState = createSettleState(0)
      const dt = PHYSICS.fixedTimeStep
      let settled = false
      let settleFrame = -1
      let currentTime = 0
      let nanFrame: { frame: number; dieIndex: number } | null = null

      // 记录投掷初始参数
      const initPositions = bodies.map((b) => `(${b.position.x.toFixed(3)}, ${b.position.y.toFixed(3)}, ${b.position.z.toFixed(3)})`)

      for (let i = 0; i < MAX_FRAMES; i++) {
        step(dt)
        currentTime += dt

        // 逃逸反射 + 记录
        for (let j = 0; j < bodies.length; j++) {
          const b = bodies[j]

          // NaN 检测：物理爆炸后立即中断
          if (Number.isNaN(b.position.x)) {
            if (!nanFrame) nanFrame = { frame: i, dieIndex: j }
            continue
          }

          const xz = Math.sqrt(b.position.x ** 2 + b.position.z ** 2)
          if (b.position.y > peakY[j]) peakY[j] = b.position.y
          if (xz > peakXZ[j]) peakXZ[j] = xz

          if (b.position.y > ESCAPE_Y && b.velocity.y > 0) {
            escapeCount[j]++
            b.velocity.y = -b.velocity.y * 0.3
          }
        }

        if (checkSettled(bodies, currentTime, settleState)) {
          settled = true
          settleFrame = i
          break
        }
      }

      // 读数
      const detailed = readAllFacesDetailed(bodies)
      const values = detailed.map((r) => r.value)
      const result = judge(values)

      // ── 输出诊断报告 ──
      console.log(`\n${'='.repeat(60)}`)
      console.log(`  Seed: ${seed}`)
      console.log(`  停稳: ${settled ? `✅ frame ${settleFrame} (${(settleFrame * dt).toFixed(2)}s)` : `❌ TIMEOUT (${MAX_FRAMES} frames / ${(MAX_FRAMES * dt).toFixed(1)}s)`}`)
      if (nanFrame) console.log(`  ⛔ NaN 检测: 骰子${nanFrame.dieIndex + 1} 在第 ${nanFrame.frame} 帧位置变为 NaN（物理爆炸）`)
      console.log(`  结果: [${values.join(', ')}] → ${result.prize} ${result.description}`)
      console.log(`${'='.repeat(60)}`)

      console.log('\n  #  点数  confidence  倾斜角    终态位置                    初始位置                    速度       角速度     sleep  peakY  peakXZ  逃逸次数  状态')
      console.log('  ' + '-'.repeat(155))

      for (let i = 0; i < 6; i++) {
        const b = bodies[i]
        const d = detailed[i]
        const angleDeg = Math.acos(Math.min(1, d.confidence)) * (180 / Math.PI)
        const isNan = Number.isNaN(b.position.x)
        const speed = isNan ? NaN : b.velocity.length()
        const angSpeed = isNan ? NaN : b.angularVelocity.length()
        const isSleep = b.sleepState === CANNON.Body.SLEEPING
        const xz = isNan ? NaN : Math.sqrt(b.position.x ** 2 + b.position.z ** 2)

        // 判断异常状态
        const flags: string[] = []
        if (isNan) flags.push('⛔ NaN')
        if (d.confidence < SETTLE.tiltThreshold) flags.push('⚠️ TILT')
        if (!isNan && b.position.y > BOWL_HEIGHT + 0.1) flags.push('🚨 飞出(Y)')
        if (!isNan && xz > BOWL_RADIUS + 0.2) flags.push('🚨 飞出(XZ)')
        if (!isNan && b.position.y < -0.1) flags.push('🚨 穿模')
        if (!isNan && speed > 0.1) flags.push('⚡ 未停')
        const status = flags.length > 0 ? flags.join(' ') : '✅'

        const posStr = isNan
          ? '(NaN)'.padEnd(28)
          : `(${b.position.x.toFixed(3)}, ${b.position.y.toFixed(3)}, ${b.position.z.toFixed(3)})`.padEnd(28)

        console.log(
          `  ${i + 1}  ` +
          `${String(d.value).padStart(2)}    ` +
          `${d.confidence.toFixed(4)}      ` +
          `${angleDeg.toFixed(1).padStart(5)}°   ` +
          posStr +
          initPositions[i].padEnd(28) +
          `${(isNan ? 'NaN' : speed.toFixed(4)).padStart(8)}   ` +
          `${(isNan ? 'NaN' : angSpeed.toFixed(4)).padStart(8)}   ` +
          `${isSleep ? 'Y' : 'N'}      ` +
          `${peakY[i].toFixed(2).padStart(5)}  ` +
          `${peakXZ[i].toFixed(2).padStart(6)}  ` +
          `${String(escapeCount[i]).padStart(5)}     ` +
          status,
        )
      }

      // 汇总
      const tiltedCount = detailed.filter((d) => d.confidence < SETTLE.tiltThreshold).length
      const nanCount = bodies.filter((b) => Number.isNaN(b.position.x)).length
      const escapedY = bodies.filter((b) => !Number.isNaN(b.position.y) && b.position.y > BOWL_HEIGHT + 0.1).length
      const escapedXZ = bodies.filter((b) => !Number.isNaN(b.position.x) && Math.sqrt(b.position.x ** 2 + b.position.z ** 2) > BOWL_RADIUS + 0.2).length
      console.log(`\n  汇总: NaN=${nanCount}  倾斜=${tiltedCount}  飞出(Y)=${escapedY}  飞出(XZ)=${escapedXZ}  逃逸反射总次数=${escapeCount.reduce((a: number, b: number) => a + b, 0)}`)
      console.log(`  参考: BOWL_RADIUS=${BOWL_RADIUS}  BOWL_HEIGHT=${BOWL_HEIGHT}  ESCAPE_Y=${ESCAPE_Y}  tiltThreshold=${SETTLE.tiltThreshold}(${(Math.acos(SETTLE.tiltThreshold) * 180 / Math.PI).toFixed(1)}°)\n`)

      dispose()
    })
  }
})
