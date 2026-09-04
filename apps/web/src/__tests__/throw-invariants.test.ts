// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import * as CANNON from 'cannon-es'
import {
  createThrowRandomPlan,
  initThrowBody,
  mapThrowHeightUnit,
  throwDice,
  type FallbackLayout,
  type ThrowDiagnostics,
  type ThrowHeightBand,
  type ThrowPlacementAlgorithm,
} from '@dice/physics-core/dice/throw'
import { THROW } from '@dice/physics-core/config/throw'
import { createDiceBody } from '@dice/physics-core/dice/dice-body'
import { setRandom, resetRandom } from '@dice/physics-core/random'

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
    return Array.from({ length: 6 }, () => {
      const body = createDiceBody()
      const mesh = {} as never // 仅需 body
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

  for (const algorithm of [
    'radial-rejection',
    'uniform-area-restarts',
    'stratified-ring',
  ] satisfies ThrowPlacementAlgorithm[]) {
    it(`${algorithm}: 固定 seed 样本同时满足 pairwise 与散布半径约束`, () => {
      const pairs = makeDicePairs()
      for (const seed of testSeeds) {
        throwDice(pairs, { seed, algorithm })

        for (let i = 0; i < pairs.length; i++) {
          const pi = pairs[i].body.position
          expect(Math.hypot(pi.x, pi.z)).toBeLessThanOrEqual(THROW.spreadRadius + 0.001)
          for (let j = i + 1; j < pairs.length; j++) {
            const pj = pairs[j].body.position
            expect(Math.hypot(pi.x - pj.x, pi.z - pj.z)).toBeGreaterThanOrEqual(
              THROW.minSeparation - 0.001,
            )
          }
        }
      }
    })
  }
})

function heightBandsForDiagnostics(
  diagnostics: ThrowDiagnostics,
  diceCount: number,
): ThrowHeightBand[] {
  if (diagnostics.placementPath !== 'fallback') return Array(diceCount).fill(null)

  const bandsByLayout: Record<FallbackLayout, ThrowHeightBand[]> = {
    ring6: ['high', 'low', 'high', 'low', 'high', 'low'],
    dual33: ['high', 'high', 'high', 'low', 'low', 'low'],
    center15: ['high', 'low', 'low', 'low', 'low', 'low'],
  }
  return bandsByLayout[diagnostics.fallbackLayout]
}

function fromUnit(unit: number, min: number, max: number): number {
  return min + unit * (max - min)
}

describe('位置 sampler 与动力学随机子流隔离', () => {
  function makeDicePairs() {
    return Array.from({ length: 6 }, () => ({
      mesh: {} as never,
      body: createDiceBody(),
    }))
  }

  it('同 seed 的 radial 与 uniform 使用完全相同的 quaternion/velocity/angular units', () => {
    const seed = 55000
    const radialPairs = makeDicePairs()
    const uniformPairs = makeDicePairs()
    const radialDiagnostics = throwDice(radialPairs, { seed, algorithm: 'radial-rejection' })
    const uniformDiagnostics = throwDice(uniformPairs, {
      seed,
      algorithm: 'uniform-area-restarts',
    })
    const plan = createThrowRandomPlan(seed, 6)
    const radialBands = heightBandsForDiagnostics(radialDiagnostics, 6)
    const uniformBands = heightBandsForDiagnostics(uniformDiagnostics, 6)

    expect(radialDiagnostics.randomPlanVersion).toBe(plan.version)
    expect(uniformDiagnostics.randomPlanVersion).toBe(plan.version)
    // 此 seed 在 uniform 五轮失败后进入分层 fallback，确保测试覆盖 height unit 重映射。
    expect(uniformDiagnostics).toMatchObject({
      placementPath: 'fallback',
      fallbackLayout: 'center15',
    })

    for (let i = 0; i < 6; i++) {
      const radial = radialPairs[i].body
      const uniform = uniformPairs[i].body
      const units = plan.dice[i]

      expect(radial.quaternion.toArray()).toEqual(uniform.quaternion.toArray())
      expect(radial.angularVelocity.toArray()).toEqual(uniform.angularVelocity.toArray())
      expect(radial.position.y).toBeCloseTo(mapThrowHeightUnit(units.height, radialBands[i]), 14)
      expect(uniform.position.y).toBeCloseTo(mapThrowHeightUnit(units.height, uniformBands[i]), 14)

      const expectedVx = fromUnit(
        units.velocity[0],
        THROW.horizontalSpeedMin,
        THROW.horizontalSpeedMax,
      )
      const expectedVy = fromUnit(units.velocity[1], THROW.downSpeedMin, THROW.downSpeedMax)
      const expectedVz = fromUnit(
        units.velocity[2],
        THROW.horizontalSpeedMin,
        THROW.horizontalSpeedMax,
      )

      // 去掉由不同初始位置产生的向心项后，两种 sampler 的基础速度完全同源。
      expect(radial.velocity.x + radial.position.x * 0.5).toBeCloseTo(expectedVx, 14)
      expect(uniform.velocity.x + uniform.position.x * 0.5).toBeCloseTo(expectedVx, 14)
      expect(radial.velocity.y).toBe(expectedVy)
      expect(uniform.velocity.y).toBe(expectedVy)
      expect(radial.velocity.z + radial.position.z * 0.5).toBeCloseTo(expectedVz, 14)
      expect(uniform.velocity.z + uniform.position.z * 0.5).toBeCloseTo(expectedVz, 14)

      const expectedAngular = units.angularVelocity.map((unit) =>
        fromUnit(unit, THROW.angularSpeedMin, THROW.angularSpeedMax),
      )
      expect(radial.angularVelocity.toArray()).toEqual(expectedAngular)
      expect(uniform.angularVelocity.toArray()).toEqual(expectedAngular)
    }
  })

  it('同 seed 的 stratified-ring 与 uniform 复用完全相同的动力学随机计划', () => {
    const seed = 72000
    const stratifiedPairs = makeDicePairs()
    const uniformPairs = makeDicePairs()

    const stratifiedDiagnostics = throwDice(stratifiedPairs, {
      seed,
      algorithm: 'stratified-ring',
    })
    throwDice(uniformPairs, { seed, algorithm: 'uniform-area-restarts' })

    expect(stratifiedDiagnostics).toMatchObject({
      placementPath: 'constructive',
      attempts: 0,
      restarts: 0,
      groupAttempts: 1,
      fallbackLayout: null,
      randomPlanVersion: 1,
    })
    for (let index = 0; index < 6; index++) {
      const stratified = stratifiedPairs[index].body
      const uniform = uniformPairs[index].body
      expect(stratified.quaternion.toArray()).toEqual(uniform.quaternion.toArray())
      expect(stratified.angularVelocity.toArray()).toEqual(uniform.angularVelocity.toArray())
      expect(stratified.position.y).toBe(uniform.position.y)
      expect(stratified.velocity.x + stratified.position.x * 0.5).toBeCloseTo(
        uniform.velocity.x + uniform.position.x * 0.5,
        14,
      )
      expect(stratified.velocity.y).toBe(uniform.velocity.y)
      expect(stratified.velocity.z + stratified.position.z * 0.5).toBeCloseTo(
        uniform.velocity.z + uniform.position.z * 0.5,
        14,
      )
    }
  })

  it('同一个 height unit 只做区间映射，不额外消费随机数', () => {
    const unit = 0.25
    expect(mapThrowHeightUnit(unit, null)).toBeCloseTo(1.3, 14)
    expect(mapThrowHeightUnit(unit, 'high')).toBeCloseTo(1.4875, 14)
    expect(mapThrowHeightUnit(unit, 'low')).toBeCloseTo(1.2375, 14)
  })
})
