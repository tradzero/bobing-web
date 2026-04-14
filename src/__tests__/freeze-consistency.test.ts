// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import * as CANNON from 'cannon-es'
import { createPhysicsWorld } from '@/physics/world'
import { createBowlBodies } from '@/physics/bowl-body'
import { setupContactMaterials, diceMaterial } from '@/physics/materials'
import { PHYSICS } from '@/config/physics'
import { setRandom, resetRandom } from '@/utils/random'
import { initThrowBody } from '@/dice/throw'
import { checkSettled, createSettleState } from '@/dice/settle'
import { readAllFaces } from '@/dice/read-face'

/**
 * 冻结前后读数一致性测试
 * 在真实物理路径结算瞬间，先读一次点数，再模拟 controller 冻结
 * （velocity/angularVelocity 归零 + sleep），再读一次点数
 * 两次结果必须完全一致
 *
 * 防止冻结改变四元数、read-face 受速度影响等隐蔽回归
 */
describe('冻结前后读数一致性', () => {
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

  const seeds = [42, 12345, 7777, 99999, 314159]

  for (const seed of seeds) {
    it(`种子 ${seed}: 冻结前后点数一致`, () => {
      setRandom(makeLCG(seed))

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
        initThrowBody(body)
        world.addBody(body)
        bodies.push(body)
      }

      const dt = 1 / 60
      const settleState = createSettleState(0)
      let settled = false

      for (let f = 0; f < 600; f++) {
        step(dt)
        const currentTime = (f + 1) * dt
        if (checkSettled(bodies, currentTime, settleState)) {
          settled = true
          break
        }
      }

      expect(settled, `种子${seed}: 未能在限定帧内结算`).toBe(true)

      // 冻结前读数
      const readBefore = readAllFaces(bodies)

      // 模拟 controller.onSettled 冻结
      for (const body of bodies) {
        body.velocity.set(0, 0, 0)
        body.angularVelocity.set(0, 0, 0)
        body.sleep()
      }

      // 冻结后读数
      const readAfter = readAllFaces(bodies)

      expect(
        readAfter,
        `种子${seed}: 冻结前${readBefore} 冻结后${readAfter}`,
      ).toEqual(readBefore)

      // 额外验证：每个点数在 1-6 范围
      for (const v of readAfter) {
        expect(v).toBeGreaterThanOrEqual(1)
        expect(v).toBeLessThanOrEqual(6)
      }

      dispose()
    })
  }
})
