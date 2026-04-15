// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import * as CANNON from 'cannon-es'
import { initThrowBody, throwDice } from '@/dice/throw'
import { THROW } from '@/config/throw'
import { PHYSICS } from '@/config/physics'
import { setRandom, resetRandom } from '@/utils/random'

/**
 * 投掷初始化不变量测试
 * 锁住 initThrowBody 的关键后置条件，防止历史根因复发：
 * - previousPosition 与 position 同步
 * - aabbNeedsUpdate 为 true
 * - 四元数已归一化
 * - 位置、速度在 THROW 配置包络内
 */
describe('投掷初始化不变量', () => {
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
    describe(`种子 ${seed}`, () => {
      function setup() {
        setRandom(makeLCG(seed))
        const body = new CANNON.Body({ mass: 1 })
        body.addShape(new CANNON.Box(new CANNON.Vec3(0.02, 0.02, 0.02)))
        // 先设置一个远离原点的旧位置，确认 initThrowBody 会同步
        body.position.set(99, 99, 99)
        body.previousPosition.set(-1, -1, -1)
        body.aabbNeedsUpdate = false
        initThrowBody(body)
        return body
      }

      it('previousPosition 与 position 同步', () => {
        const body = setup()
        expect(body.previousPosition.x).toBe(body.position.x)
        expect(body.previousPosition.y).toBe(body.position.y)
        expect(body.previousPosition.z).toBe(body.position.z)
      })

      it('aabbNeedsUpdate 为 true', () => {
        const body = setup()
        expect(body.aabbNeedsUpdate).toBe(true)
      })

      it('四元数已归一化（模长 ≈ 1）', () => {
        const body = setup()
        const q = body.quaternion
        const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)
        expect(len).toBeCloseTo(1, 6)
      })

      it('位置在 THROW 包络内', () => {
        const body = setup()
        const { x, y, z } = body.position
        const horizontalR = Math.sqrt(x * x + z * z)
        expect(horizontalR).toBeLessThanOrEqual(THROW.spreadRadius + 0.001)
        expect(y).toBeGreaterThanOrEqual(THROW.heightMin - 0.001)
        expect(y).toBeLessThanOrEqual(THROW.heightMax + 0.001)
      })

      it('向下速度在 THROW 包络内', () => {
        const body = setup()
        // vy 纯由 randomRange(downSpeedMin, downSpeedMax) 生成，无额外偏移
        expect(body.velocity.y).toBeGreaterThanOrEqual(THROW.downSpeedMin - 0.001)
        expect(body.velocity.y).toBeLessThanOrEqual(THROW.downSpeedMax + 0.001)
      })

      it('角速度在 THROW 包络内', () => {
        const body = setup()
        const av = body.angularVelocity
        for (const c of [av.x, av.y, av.z]) {
          expect(c).toBeGreaterThanOrEqual(THROW.angularSpeedMin - 0.001)
          expect(c).toBeLessThanOrEqual(THROW.angularSpeedMax + 0.001)
        }
      })
    })
  }
})

/**
 * 批量投掷 pairwise 最小间距测试
 * 锁住 throwDice 的去重保证：任意两颗骰子初始水平距离 >= THROW.minSeparation
 */
describe('批量投掷初始间距', () => {
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

  function makeDicePairs() {
    const hs = PHYSICS.diceHalfSize
    return Array.from({ length: 6 }, () => {
      const body = new CANNON.Body({ mass: PHYSICS.diceMass })
      body.addShape(new CANNON.Box(new CANNON.Vec3(hs, hs, hs)))
      const mesh = {} as any // 仅需 body
      return { mesh, body }
    })
  }

  // 多种子覆盖，包含曾触发重叠的 seed
  const testSeeds = [42, 12345, 7777, 99999, 314159, 1, 65535, 123456789]

  for (const seed of testSeeds) {
    it(`种子 ${seed}: 任意两颗骰子水平间距 >= minSeparation (${THROW.minSeparation.toFixed(3)}m)`, () => {
      setRandom(makeLCG(seed))
      const pairs = makeDicePairs()
      throwDice(pairs)

      for (let i = 0; i < pairs.length; i++) {
        for (let j = i + 1; j < pairs.length; j++) {
          const pi = pairs[i].body.position
          const pj = pairs[j].body.position
          const dx = pi.x - pj.x
          const dz = pi.z - pj.z
          const dist = Math.sqrt(dx * dx + dz * dz)
          expect(
            dist,
            `骰子${i + 1}与骰子${j + 1}水平距离=${dist.toFixed(4)} < ${THROW.minSeparation}`,
          ).toBeGreaterThanOrEqual(THROW.minSeparation - 0.001)
        }
      }
    })
  }
})
