// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import * as CANNON from 'cannon-es'
import { createPhysicsWorld } from '@/physics/world'
import { createBowlBodies } from '@/physics/bowl-body'
import { setupContactMaterials } from '@/physics/materials'
import { PHYSICS } from '@/config/physics'
import { setRandom, resetRandom } from '@/utils/random'
import { diceMaterial } from '@/physics/materials'
import { initThrowBody } from '@/dice/throw'
import { checkSettled, createSettleState } from '@/dice/settle'

/**
 * 物理烟雾测试
 * 真实 cannon-es 世界 + 碗碰撞体 + 6 骰子
 * 使用运行时 initThrowBody 投掷包络初始化
 * 断言无 NaN、不飞出、结算路径不超时、结算帧数有上限
 */
describe('物理烟雾测试', () => {
  afterEach(() => {
    resetRandom()
  })

  function makeLCG(initialSeed: number) {
    let seed = initialSeed
    return () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }
  }

  /** 通用模拟：用 initThrowBody 初始化，跑 checkSettled，返回结果 */
  function runSmoke(initialSeed: number, maxFrames: number) {
    setRandom(makeLCG(initialSeed))

    const { world, step, dispose } = createPhysicsWorld()
    setupContactMaterials(world)
    createBowlBodies(world)

    const hs = PHYSICS.diceHalfSize
    const bodies: CANNON.Body[] = []
    for (let i = 0; i < 6; i++) {
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
      // 运行时投掷包络
      initThrowBody(body)
      world.addBody(body)
      bodies.push(body)
    }

    const dt = 1 / 60
    const settleState = createSettleState(0)
    let nanDetected = false
    let escaped = false
    let settleFrame = -1
    let timedOut = false

    for (let f = 0; f < maxFrames; f++) {
      step(dt)
      const currentTime = (f + 1) * dt

      for (const body of bodies) {
        if (Number.isNaN(body.position.x) || Number.isNaN(body.position.y) || Number.isNaN(body.position.z)) {
          nanDetected = true
        }
        if (body.position.y < -1 || Math.abs(body.position.x) > 5 || Math.abs(body.position.z) > 5) {
          escaped = true
        }
      }

      if (settleFrame < 0 && checkSettled(bodies, currentTime, settleState)) {
        settleFrame = f + 1
        // 检查是否超时路径
        const elapsed = currentTime - settleState.startTime
        if (elapsed >= 10.0) timedOut = true
        break
      }
    }

    dispose()
    return { nanDetected, escaped, settleFrame, timedOut }
  }

  // 包含常规种子 + 曾经有问题的坏种子
  const seeds = [42, 12345, 7777, 99999, 314159, 1, 65535, 123456789, 2718281, 5555]

  for (const seed of seeds) {
    it(`种子 ${seed}: 无 NaN、不飞出、不超时、帧数 ≤ 480`, () => {
      const result = runSmoke(seed, 600)
      expect(result.nanDetected, `种子${seed}: 检测到 NaN`).toBe(false)
      expect(result.escaped, `种子${seed}: 骰子飞出合理范围`).toBe(false)
      expect(result.timedOut, `种子${seed}: 结算走了超时路径`).toBe(false)
      expect(result.settleFrame, `种子${seed}: 未在限定帧内结算`).toBeGreaterThan(0)
      expect(
        result.settleFrame,
        `种子${seed}: 结算帧数=${result.settleFrame}（上限480）`,
      ).toBeLessThanOrEqual(480)
    })
  }
})
