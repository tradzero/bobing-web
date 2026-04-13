// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import * as CANNON from 'cannon-es'
import { createPhysicsWorld } from '@/physics/world'
import { createBowlBodies } from '@/physics/bowl-body'
import { setupContactMaterials } from '@/physics/materials'
import { PHYSICS } from '@/config/physics'
import { setRandom, resetRandom } from '@/utils/random'

/**
 * 物理烟雾测试
 * 真实 cannon-es 世界 + 碗碰撞体 + 6 骰子
 * 固定种子跑若干帧，验证无 NaN、不掉出桌面、能在预期时间内结算或触发超时
 */
describe('物理烟雾测试', () => {
  afterEach(() => {
    resetRandom()
  })

  it('固定种子 - 骰子不产生 NaN、不掉出桌面', () => {
    // 固定种子
    let seed = 12345
    setRandom(() => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    })

    const { world, step, dispose } = createPhysicsWorld()
    setupContactMaterials(world)
    createBowlBodies(world)

    // 创建 6 颗骰子 body
    const hs = PHYSICS.diceHalfSize
    const bodies: CANNON.Body[] = []
    for (let i = 0; i < 6; i++) {
      const body = new CANNON.Body({
        mass: PHYSICS.diceMass,
        allowSleep: true,
        sleepSpeedLimit: PHYSICS.diceSleepSpeedLimit,
        sleepTimeLimit: PHYSICS.diceSleepTimeLimit,
      })
      body.addShape(new CANNON.Box(new CANNON.Vec3(hs, hs, hs)))

      // 碗上方散布
      const angle = (i / 6) * Math.PI * 2
      body.position.set(Math.cos(angle) * 0.2, 2 + i * 0.1, Math.sin(angle) * 0.2)
      body.velocity.set(0, -2, 0)
      body.angularVelocity.set(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
      )
      world.addBody(body)
      bodies.push(body)
    }

    // 跑 600 帧（约 10 秒 @ 60fps）
    const frames = 600
    const dt = 1 / 60

    for (let f = 0; f < frames; f++) {
      step(dt)

      for (const body of bodies) {
        // 无 NaN
        expect(Number.isNaN(body.position.x)).toBe(false)
        expect(Number.isNaN(body.position.y)).toBe(false)
        expect(Number.isNaN(body.position.z)).toBe(false)

        // 不掉出桌面（y 不低于 -1）
        expect(body.position.y).toBeGreaterThan(-1)

        // 不飞太远（x, z 在合理范围内）
        expect(Math.abs(body.position.x)).toBeLessThan(5)
        expect(Math.abs(body.position.z)).toBeLessThan(5)
      }
    }

    // 跑完后至少有一些骰子进入 sleep 或低速
    const someSleeping = bodies.some((b) => b.sleepState === 2)
    const someSlow = bodies.some(
      (b) => b.velocity.length() < 0.5 && b.angularVelocity.length() < 0.5,
    )
    expect(someSleeping || someSlow).toBe(true)

    dispose()
  })

  it('多组种子稳定性验证', () => {
    const seeds = [42, 7777, 99999, 314159]

    for (const initialSeed of seeds) {
      let seed = initialSeed
      setRandom(() => {
        seed = (seed * 16807) % 2147483647
        return (seed - 1) / 2147483646
      })

      const { world, step, dispose } = createPhysicsWorld()
      setupContactMaterials(world)
      createBowlBodies(world)

      const hs = PHYSICS.diceHalfSize
      const bodies: CANNON.Body[] = []
      for (let i = 0; i < 6; i++) {
        const body = new CANNON.Body({ mass: PHYSICS.diceMass })
        body.addShape(new CANNON.Box(new CANNON.Vec3(hs, hs, hs)))
        const angle = (i / 6) * Math.PI * 2
        body.position.set(Math.cos(angle) * 0.25, 2.2 + i * 0.08, Math.sin(angle) * 0.25)
        body.velocity.set((seed % 3 - 1) * 0.3, -2.5, (seed % 5 - 2) * 0.2)
        world.addBody(body)
        bodies.push(body)
      }

      // 跑 300 帧
      for (let f = 0; f < 300; f++) {
        step(1 / 60)
        for (const body of bodies) {
          expect(Number.isNaN(body.position.x)).toBe(false)
          expect(Number.isNaN(body.position.y)).toBe(false)
          expect(Number.isNaN(body.position.z)).toBe(false)
          expect(body.position.y).toBeGreaterThan(-1)
        }
      }

      dispose()
    }
  })
})
