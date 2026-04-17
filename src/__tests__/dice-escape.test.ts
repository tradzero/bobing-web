// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import * as CANNON from 'cannon-es'
import { createPhysicsWorld } from '@/physics/world'
import { createBowlBodies, ESCAPE_Y, BOWL_RADIUS } from '@/physics/bowl-body'
import { setupContactMaterials } from '@/physics/materials'
import { createDiceBody } from '@/dice/dice-body'
import { setRandom, resetRandom } from '@/utils/random'
import { initThrowBody } from '@/dice/throw'
import { checkSettled, createSettleState } from '@/dice/settle'

/**
 * 骰子逃逸防护回归测试
 * 模拟真实投掷 + 引擎逃逸反射逻辑，断言骰子不会飞出碗外
 * 若后续修改投掷参数、碗形状或逃逸防护逻辑后骰子跑出，此测试会失败
 */
describe('骰子逃逸防护', () => {
  afterEach(() => resetRandom())

  function makeLCG(seed: number) {
    let s = seed
    return () => {
      s = (s * 16807) % 2147483647
      return (s - 1) / 2147483646
    }
  }

  /** 反弹后最大允许高度：碗口高度 + 合理反弹余量 */
  const MAX_BOUNCE_Y = ESCAPE_Y + 0.6
  /** 最大允许水平距离：碗半径 + 安全余量 */
  const MAX_ALLOWED_XZ = BOWL_RADIUS + 1.0

  /**
   * 运行单次投掷模拟，包含与 engine.ts 相同的逃逸反射逻辑
   * 跳过初始下落阶段（前 30 帧），只追踪骰子触碗反弹后的峰值
   */
  function runEscapeTest(seed: number) {
    setRandom(makeLCG(seed))

    const { world, step, dispose } = createPhysicsWorld()
    setupContactMaterials(world)
    createBowlBodies(world)

    const bodies: CANNON.Body[] = []
    for (let i = 0; i < 6; i++) {
      const body = createDiceBody()
      initThrowBody(body)
      world.addBody(body)
      bodies.push(body)
    }

    const dt = 1 / 60
    const settleState = createSettleState(0)
    const maxFrames = 600
    // 跳过初始下落阶段，骰子从 1.2-1.6m 自由落体到碗底大约需要 ~20 帧
    const trackAfterFrame = 30
    let peakBounceY = -Infinity
    let peakXZ = 0
    let escapedBounceY = false
    let escapedXZ = false

    for (let f = 0; f < maxFrames; f++) {
      // 物理步进
      step(dt)

      // 逃逸防护（与 engine.ts 完全一致）
      for (const body of bodies) {
        if (body.position.y > ESCAPE_Y && body.velocity.y > 0) {
          body.velocity.y = -body.velocity.y * 0.3
        }
      }

      // 首次触碗后才开始追踪反弹峰值
      if (f >= trackAfterFrame) {
        for (const body of bodies) {
          if (body.position.y > peakBounceY) peakBounceY = body.position.y
          const xz = Math.sqrt(body.position.x ** 2 + body.position.z ** 2)
          if (xz > peakXZ) peakXZ = xz

          if (body.position.y > MAX_BOUNCE_Y) escapedBounceY = true
          if (xz > MAX_ALLOWED_XZ) escapedXZ = true
        }
      }

      const currentTime = (f + 1) * dt
      if (checkSettled(bodies, currentTime, settleState, world)) break
    }

    dispose()
    return { peakBounceY, peakXZ, escapedBounceY, escapedXZ }
  }

  // 覆盖多个种子，包括容易产生极端弹跳的随机序列
  const seeds = [42, 1, 7777, 12345, 99999, 314159, 65535, 123456789, 271828, 5555,
    666, 11111, 54321, 777777, 1000000, 8675309, 31337, 13, 9999999, 2024]

  for (const seed of seeds) {
    it(`种子 ${seed}: 反弹后骰子未逃逸碗外（Y ≤ ${MAX_BOUNCE_Y}m, XZ ≤ ${MAX_ALLOWED_XZ}m）`, { timeout: 30_000 }, () => {
      const r = runEscapeTest(seed)
      expect(r.escapedBounceY, `种子${seed}: 反弹后飞到 Y=${r.peakBounceY.toFixed(3)}m`).toBe(false)
      expect(r.escapedXZ, `种子${seed}: 水平距离=${r.peakXZ.toFixed(3)}m`).toBe(false)
    })
  }

  it('逃逸反射使反弹峰值 Y 收敛在合理范围', { timeout: 60_000 }, () => {
    const allPeaks: number[] = []
    for (const seed of seeds) {
      const r = runEscapeTest(seed)
      allPeaks.push(r.peakBounceY)
    }
    const maxPeak = Math.max(...allPeaks)
    // 反射后骰子反弹峰值不应超过阈值
    expect(maxPeak).toBeLessThan(MAX_BOUNCE_Y)
  })

  it('结算时所有骰子都在碗内', () => {
    // 用几个种子验证结算后骰子位置
    for (const seed of [42, 12345, 314159]) {
      setRandom(makeLCG(seed))

      const { world, step, dispose } = createPhysicsWorld()
      setupContactMaterials(world)
      createBowlBodies(world)

      const bodies: CANNON.Body[] = []
      for (let i = 0; i < 6; i++) {
        const body = createDiceBody()
        initThrowBody(body)
        world.addBody(body)
        bodies.push(body)
      }

      const dt = 1 / 60
      const settleState = createSettleState(0)
      for (let f = 0; f < 600; f++) {
        step(dt)
        for (const body of bodies) {
          if (body.position.y > ESCAPE_Y && body.velocity.y > 0) {
            body.velocity.y = -body.velocity.y * 0.3
          }
        }
        if (checkSettled(bodies, (f + 1) * dt, settleState, world)) break
      }

      // 结算后骰子应在碗内（Y > -0.5, 水平距 < 碗半径）
      for (const body of bodies) {
        expect(body.position.y, `种子${seed}: 结算后 Y 过低`).toBeGreaterThan(-0.5)
        const xz = Math.sqrt(body.position.x ** 2 + body.position.z ** 2)
        expect(xz, `种子${seed}: 结算后超出碗半径`).toBeLessThan(BOWL_RADIUS)
      }

      dispose()
      resetRandom()
    }
  })
})
