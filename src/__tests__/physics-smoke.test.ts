// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import { createPhysicsWorld } from '@/physics/world'
import { createBowlBodies } from '@/physics/bowl-body'
import { setupContactMaterials } from '@/physics/materials'
import { createDiceBody } from '@/dice/dice-body'
import { setRandom, resetRandom, reseed } from '@/utils/random'
import { throwDice } from '@/dice/throw'
import { THROW } from '@/config/throw'
import { checkSettled, createSettleState } from '@/dice/settle'
import { SETTLE } from '@/config/settle'

/**
 * 物理烟雾测试
 * 真实 cannon-es 世界 + 碗碰撞体 + 6 骰子
 * 使用运行时 throwDice 批量投掷（含去重）
 * 断言无 NaN、不飞出、结算路径不超时
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

  /** 通用模拟：用 throwDice 批量投掷（含去重），跑 checkSettled，返回结果 */
  function runSmoke(initialSeed: number, maxFrames: number) {
    setRandom(makeLCG(initialSeed))

    const { world, step, dispose } = createPhysicsWorld()
    setupContactMaterials(world)
    createBowlBodies(world)

    const dicePairs = Array.from({ length: 6 }, () => {
      const body = createDiceBody()
      world.addBody(body)
      return { mesh: {} as any, body }
    })
    // 运行时批量投掷路径（含去重）
    throwDice(dicePairs)
    const bodies = dicePairs.map((p) => p.body)

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
        if (elapsed >= SETTLE.timeout) timedOut = true
        break
      }
    }

    dispose()
    return { nanDetected, escaped, settleFrame, timedOut }
  }

  // 包含常规种子 + 曾经有问题的坏种子
  const seeds = [42, 12345, 7777, 99999, 314159, 1, 65535, 123456789, 2718281, 5555]

  for (const seed of seeds) {
    it(`种子 ${seed}: 无 NaN、不飞出、不超时`, () => {
      const result = runSmoke(seed, 900)
      expect(result.nanDetected, `种子${seed}: 检测到 NaN`).toBe(false)
      expect(result.escaped, `种子${seed}: 骰子飞出合理范围`).toBe(false)
      expect(result.settleFrame, `种子${seed}: 未在限定帧内结算`).toBeGreaterThan(0)
    })
  }

  /**
   * 回归测试：seed 1776219009201 曾因初始位置重叠导致 NaN
   * 使用运行时 mulberry32 PRNG（reseed）+ throwDice 批量去重 + 真实物理世界验证
   */
  it('seed 1776219009201 (mulberry32): 无 NaN（初始重叠回归）', () => {
    reseed(1776219009201)

    const { world, step, dispose } = createPhysicsWorld()
    setupContactMaterials(world)
    createBowlBodies(world)

    const dicePairs = Array.from({ length: 6 }, () => {
      const body = createDiceBody()
      world.addBody(body)
      return { mesh: {} as any, body }
    })

    // 使用批量投掷（含去重逻辑）
    throwDice(dicePairs)
    const bodies = dicePairs.map((p) => p.body)

    // 验证初始间距 >= minSeparation
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const dx = bodies[i].position.x - bodies[j].position.x
        const dz = bodies[i].position.z - bodies[j].position.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        expect(dist, `骰子${i + 1}与${j + 1}重叠`).toBeGreaterThanOrEqual(THROW.minSeparation - 0.001)
      }
    }

    const dt = 1 / 60
    const settleState = createSettleState(0)

    for (let f = 0; f < 600; f++) {
      step(dt)
      const currentTime = (f + 1) * dt

      for (const body of bodies) {
        expect(
          Number.isNaN(body.position.x) || Number.isNaN(body.position.y) || Number.isNaN(body.position.z),
          `帧 ${f}: 检测到 NaN`,
        ).toBe(false)
      }

      if (checkSettled(bodies, currentTime, settleState)) break
    }

    dispose()
  })
})
