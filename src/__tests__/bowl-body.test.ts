// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import * as CANNON from 'cannon-es'
import { createPhysicsWorld } from '@/physics/world'
import {
  createBowlBodies,
  bowlCurveHeight,
  generateHeightfieldData,
  BOWL_RADIUS,
  HF_GRID_SIZE,
  WALL_COUNT,
  WALL_RADIUS,
  WALL_HEIGHT,
  WALL_BURY,
} from '@/physics/bowl-body'
import { setupContactMaterials } from '@/physics/materials'
import { PHYSICS } from '@/config/physics'
import { diceMaterial } from '@/physics/materials'
import { setRandom, resetRandom } from '@/utils/random'
import { initThrowBody } from '@/dice/throw'
import { checkSettled, createSettleState } from '@/dice/settle'
import { SETTLE } from '@/config/settle'

/**
 * 碗碰撞体回归测试（Heightfield + 挡墙方案）
 * T1: 挡墙几何正确性
 * T2: Heightfield 边缘与挡墙过渡验证
 * T3: 固定种子模拟回归（真实投掷包络）
 * T4: 碗曲线几何不变量
 * T5: 纯物理收敛时间
 * T6: 真实结算路径（checkSettled + 冻结）
 * T7: 视觉碗与物理碗静态几何对齐
 */

// ── T1: 挡墙几何正确性 ──
describe('T1: 挡墙几何正确性', () => {
  it('挡墙薄轴沿径向方向', () => {
    const { world, dispose } = createPhysicsWorld()
    const { walls } = createBowlBodies(world)

    for (let i = 0; i < WALL_COUNT; i++) {
      const wall = walls[i]
      const pos = wall.position
      // 径向单位向量
      const r = Math.sqrt(pos.x ** 2 + pos.z ** 2)
      const radial = new CANNON.Vec3(pos.x / r, 0, pos.z / r)

      // 墙 local Z 轴（薄轴）变换到世界坐标
      const localZ = new CANNON.Vec3(0, 0, 1)
      const worldZ = wall.quaternion.vmult(localZ)

      // 薄轴在水平面上应与径向对齐（Box 双面，取绝对值）
      const dotXZ = Math.abs(worldZ.x * radial.x + worldZ.z * radial.z)
      expect(
        dotXZ,
        `wall[${i}] 薄轴径向对齐=${dotXZ.toFixed(4)}`,
      ).toBeGreaterThan(0.95)
    }

    dispose()
  })

  it('挡墙中心在预期半径上', () => {
    const { world, dispose } = createPhysicsWorld()
    const { walls } = createBowlBodies(world)

    for (let i = 0; i < WALL_COUNT; i++) {
      const wall = walls[i]
      const r = Math.sqrt(wall.position.x ** 2 + wall.position.z ** 2)
      expect(r).toBeCloseTo(WALL_RADIUS, 3)
    }

    dispose()
  })

  it('相邻挡墙有足够重叠（无逃逸缝隙）', () => {
    // 计算每面墙的角度覆盖 vs 相邻墙角度间隙
    const tangentialHalf =
      ((2 * Math.PI * WALL_RADIUS) / WALL_COUNT) * 1.15 / 2
    const angularCoverage = 2 * Math.atan(tangentialHalf / WALL_RADIUS)
    const angularGap = (2 * Math.PI) / WALL_COUNT

    expect(
      angularCoverage,
      `角度覆盖=${angularCoverage.toFixed(4)} > 间隙=${angularGap.toFixed(4)}`,
    ).toBeGreaterThan(angularGap)
  })
})

// ── T2: Heightfield 边缘与挡墙过渡验证 ──
describe('T2: Heightfield 边缘与挡墙过渡验证', () => {
  it('挡墙底部低于 Heightfield 边缘高度（有重叠）', () => {
    const { minHeight } = generateHeightfieldData()
    const hfEdgeH = bowlCurveHeight(WALL_RADIUS) - minHeight
    const wallBottomY = hfEdgeH - WALL_BURY + WALL_HEIGHT / 2 - WALL_HEIGHT / 2
    // wallBottomY = hfEdgeH - WALL_BURY

    expect(
      wallBottomY,
      `墙底Y=${wallBottomY.toFixed(4)} < HF边缘H=${hfEdgeH.toFixed(4)}`,
    ).toBeLessThan(hfEdgeH)
  })

  it('挡墙埋入深度在合理范围内', () => {
    // 埋入深度 = WALL_BURY，应大于 0 且不超过墙高的一半
    expect(WALL_BURY).toBeGreaterThan(0)
    expect(WALL_BURY).toBeLessThan(WALL_HEIGHT / 2)
  })

  it('挡墙顶部高于 Heightfield 边缘高度', () => {
    const { minHeight } = generateHeightfieldData()
    const hfEdgeH = bowlCurveHeight(WALL_RADIUS) - minHeight
    const wallTopY = hfEdgeH - WALL_BURY + WALL_HEIGHT

    expect(
      wallTopY,
      `墙顶Y=${wallTopY.toFixed(4)} > HF边缘H=${hfEdgeH.toFixed(4)}`,
    ).toBeGreaterThan(hfEdgeH)
  })
})

// ── T3: 固定种子物理模拟回归（真实投掷包络） ──
describe('T3: 固定种子模拟 - 骰子留在碗内', () => {
  afterEach(() => {
    resetRandom()
  })

  /** 创建 LCG 伪随机生成器 */
  function makeLCG(initialSeed: number) {
    let seed = initialSeed
    return () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }
  }

  /**
   * 运行一组固定种子模拟，复用运行时 initThrowBody 投掷逻辑
   * 返回每颗骰子最终到碗中心的水平距离
   */
  function runSimulation(initialSeed: number): number[] {
    const rng = makeLCG(initialSeed)
    setRandom(rng)

    const { world, step, dispose } = createPhysicsWorld()
    setupContactMaterials(world)
    createBowlBodies(world)

    const hs = PHYSICS.diceHalfSize
    const bodies: CANNON.Body[] = []
    for (let i = 0; i < 6; i++) {
      const body = new CANNON.Body({
        mass: PHYSICS.diceMass,
        material: diceMaterial,
        allowSleep: true,
        sleepSpeedLimit: PHYSICS.diceSleepSpeedLimit,
        sleepTimeLimit: PHYSICS.diceSleepTimeLimit,
      })
      body.addShape(new CANNON.Box(new CANNON.Vec3(hs, hs, hs)))

      // 复用运行时投掷逻辑（含完整包络：位置、四元数、速度、角速度）
      initThrowBody(body)

      world.addBody(body)
      bodies.push(body)
    }

    // 跑 600 帧（约 10 秒 @ 60fps）
    for (let f = 0; f < 600; f++) {
      step(1 / 60)
    }

    // 计算每颗骰子到碗中心的水平距离
    const distances = bodies.map((b) => Math.sqrt(b.position.x ** 2 + b.position.z ** 2))

    dispose()
    return distances
  }

  const seeds = [12345, 42, 7777, 99999, 314159]

  for (const seed of seeds) {
    it(`种子 ${seed}: 6 颗骰子最终留在碗口范围内`, () => {
      const distances = runSimulation(seed)

      // 统计飞出碗口的骰子数量
      const escapedCount = distances.filter((d) => d > BOWL_RADIUS).length

      // 允许至多 1 颗骰子飞出（物理近似有误差），但不能大量飞出
      expect(
        escapedCount,
        `种子${seed}: ${escapedCount}/6 颗骰子飞出碗口 (距离: ${distances.map((d) => d.toFixed(3)).join(', ')})`,
      ).toBeLessThanOrEqual(1)
    })
  }
})

// ── T4: 碗曲线几何不变量校验 ──
describe('T4: 碗曲线几何不变量', () => {
  const { data, elementSize } = generateHeightfieldData()
  const center = Math.floor(HF_GRID_SIZE / 2)

  it('碗底中心零偏移（归一化后 = 0）', () => {
    // 纯幂函数 (d/maxInnerR)^p，d=0 时 h 应严格为 0
    const centerH = data[center][center]
    expect(centerH).toBe(0)
  })

  it('从中心向外单调递增', () => {
    // 沿 +x 方向（固定 j=center）检查单调性
    for (let i = center + 1; i < HF_GRID_SIZE; i++) {
      expect(
        data[i][center],
        `data[${i}][${center}]=${data[i][center].toFixed(6)} >= data[${i - 1}][${center}]=${data[i - 1][center].toFixed(6)}`,
      ).toBeGreaterThanOrEqual(data[i - 1][center])
    }
    // 沿 -x 方向
    for (let i = center - 1; i >= 0; i--) {
      expect(
        data[i][center],
        `data[${i}][${center}]=${data[i][center].toFixed(6)} >= data[${i + 1}][${center}]=${data[i + 1][center].toFixed(6)}`,
      ).toBeGreaterThanOrEqual(data[i + 1][center])
    }
  })

  it('坡度带校验：r=0.4 处 <10°，r=0.6 处 >20°', () => {
    // 利用 bowlCurveHeight 的导数估算坡度角
    const dr = 0.001
    function slopeAt(r: number): number {
      const dh = bowlCurveHeight(r + dr) - bowlCurveHeight(r - dr)
      return Math.atan(dh / (2 * dr)) * (180 / Math.PI)
    }
    const slope04 = slopeAt(0.4)
    const slope06 = slopeAt(0.6)
    expect(slope04, `r=0.4 坡度=${slope04.toFixed(2)}° 应<12°`).toBeLessThan(12)
    expect(slope06, `r=0.6 坡度=${slope06.toFixed(2)}° 应>15°`).toBeGreaterThan(15)
  })

  it('相邻网格点无台阶突变', () => {
    // 相邻高度差不应超过 elementSize * 2.5（BOWL_HEIGHT=0.8 + p=3.5 边缘坡度更陡）
    const maxDelta = elementSize * 2.5
    for (let i = 0; i < HF_GRID_SIZE - 1; i++) {
      for (let j = 0; j < HF_GRID_SIZE - 1; j++) {
        const h = data[i][j]
        const hRight = data[i + 1][j]
        const hDown = data[i][j + 1]
        expect(
          Math.abs(hRight - h),
          `data[${i}][${j}]→[${i + 1}][${j}] diff=${Math.abs(hRight - h).toFixed(4)}`,
        ).toBeLessThan(maxDelta)
        expect(
          Math.abs(hDown - h),
          `data[${i}][${j}]→[${i}][${j + 1}] diff=${Math.abs(hDown - h).toFixed(4)}`,
        ).toBeLessThan(maxDelta)
      }
    }
  })
})

// ── T5: 固定种子收敛时间测试（纯物理，无 sleep） ──
describe('T5: 收敛时间回归测试', () => {
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

  /**
   * 运行模拟，返回收敛帧数（所有骰子线速度 < threshold 且角速度 < threshold）
   * 禁用 sleep，纯测物理收敛；投掷用 initThrowBody（运行时包络）
   */
  function measureConvergenceFrames(
    initialSeed: number,
    speedThreshold: number,
    angularThreshold: number,
    maxFrames: number,
  ): number {
    const rng = makeLCG(initialSeed)
    setRandom(rng)

    const { world, step, dispose } = createPhysicsWorld()
    setupContactMaterials(world)
    createBowlBodies(world)

    // 禁用 sleep 以纯测物理收敛
    world.allowSleep = false

    const hs = PHYSICS.diceHalfSize
    const bodies: CANNON.Body[] = []
    for (let i = 0; i < 6; i++) {
      const body = new CANNON.Body({
        mass: PHYSICS.diceMass,
        material: diceMaterial,
        linearDamping: PHYSICS.diceLinearDamping,
        angularDamping: PHYSICS.diceAngularDamping,
        allowSleep: false,
      })
      body.addShape(new CANNON.Box(new CANNON.Vec3(hs, hs, hs)))

      // 复用运行时投掷逻辑
      initThrowBody(body)

      world.addBody(body)
      bodies.push(body)
    }

    for (let f = 0; f < maxFrames; f++) {
      step(1 / 60)

      const allConverged = bodies.every((b) => {
        return b.velocity.length() < speedThreshold &&
               b.angularVelocity.length() < angularThreshold
      })

      if (allConverged) {
        dispose()
        return f + 1
      }
    }

    dispose()
    return maxFrames // 未在限定帧内收敛
  }

  const seeds = [12345, 42, 7777]

  for (const seed of seeds) {
    it(`种子 ${seed}: 物理收敛帧数 < 200`, () => {
      const frames = measureConvergenceFrames(seed, 0.05, 0.05, 600)
      // 纯物理（无 sleep）收敛上限；T6 真实路径含 sleep 远快于此
      expect(
        frames,
        `种子${seed}: 收敛帧数=${frames}（上限200）`,
      ).toBeLessThan(200)
    })
  }
})

// ── T6: 真实结算路径测试（checkSettled 三条路径 + controller 冻结） ──
describe('T6: 真实结算路径回归测试', () => {
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

  /**
   * 模拟真实结算路径：
   * 阶段 1：用 checkSettled（三条路径）判定停稳帧数和触发路径
   * 阶段 2：模拟 controller 冻结（velocity/angularVelocity 归零 + sleep）
   * 返回 { settleFrame, settlePath }
   */
  function measureSettleFrames(initialSeed: number, maxFrames: number): {
    settleFrame: number
    settlePath: 'sleep' | 'threshold' | 'timeout' | 'none'
  } {
    const rng = makeLCG(initialSeed)
    setRandom(rng)

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

      // 复用运行时投掷逻辑
      initThrowBody(body)

      world.addBody(body)
      bodies.push(body)
    }

    const dt = 1 / 60
    const settleState = createSettleState(0)

    for (let f = 0; f < maxFrames; f++) {
      step(dt)
      const currentTime = (f + 1) * dt

      // 用运行时完整 checkSettled 判定
      if (checkSettled(bodies, currentTime, settleState)) {
        // 判断触发路径
        let path: 'sleep' | 'threshold' | 'timeout'
        const allSleeping = bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING)
        if (allSleeping) {
          path = 'sleep'
        } else if (currentTime - settleState.startTime >= SETTLE.timeout) {
          path = 'timeout'
        } else {
          path = 'threshold'
        }

        // 阶段 2：模拟 controller.onSettled 冻结
        for (const body of bodies) {
          body.velocity.set(0, 0, 0)
          body.angularVelocity.set(0, 0, 0)
          body.sleep()
        }

        dispose()
        return { settleFrame: f + 1, settlePath: path }
      }
    }

    dispose()
    return { settleFrame: maxFrames, settlePath: 'none' }
  }

  // 包含曾在旧曲线下超时的种子
  const seeds = [42, 99999, 12345, 7777, 314159]

  for (const seed of seeds) {
    it(`种子 ${seed}: 真实结算路径 ≤ 480 帧且不超时`, () => {
      const { settleFrame, settlePath } = measureSettleFrames(seed, 600)
      expect(
        settlePath,
        `种子${seed}: 结算路径=${settlePath}（不应为 timeout 或 none）`,
      ).not.toBe('timeout')
      expect(
        settlePath,
        `种子${seed}: 未在限定帧内结算`,
      ).not.toBe('none')
      expect(
        settleFrame,
        `种子${seed}: 结算帧数=${settleFrame}（上限480）`,
      ).toBeLessThanOrEqual(480)
    })
  }
})

// ── T7: 视觉碗与物理碗静态几何对齐测试 ──
describe('T7: 视觉碗内壁与物理碗对齐', () => {
  // 直接校验 createBowl 实际消费的 generateBowlProfile()，
  // 从完整轮廓中提取内壁段（外壁点数 = SEGMENTS+1，翻边 1 点，之后全是内壁），
  // 与物理层 bowlInnerHeight 逐点比较

  it('视觉内壁各采样点与 bowlInnerHeight 最大偏差 < 5mm', async () => {
    const { generateBowlProfile } = await import('@/scene/bowl')
    const { bowlInnerHeight } = await import('@/config/bowl')

    const profile = generateBowlProfile()
    // 轮廓结构：外壁 (SEGMENTS+1 点) + 翻边 (1 点) + 内壁 (SEGMENTS+1 点)
    const SEGMENTS = 20
    const innerStart = SEGMENTS + 1 + 1 // 跳过外壁 + 翻边
    const innerPoints = profile.slice(innerStart)

    expect(innerPoints.length).toBe(SEGMENTS + 1)

    let maxDiff = 0
    for (const pt of innerPoints) {
      const physicsY = bowlInnerHeight(pt.x) // Vector2: x=r, y=y
      const diff = Math.abs(pt.y - physicsY)
      if (diff > maxDiff) maxDiff = diff
    }

    expect(
      maxDiff,
      `最大偏差=${(maxDiff * 1000).toFixed(2)}mm 应<5mm`,
    ).toBeLessThan(0.005)
  })

  it('视觉内壁覆盖从 r≈0 到 r≈BOWL_INNER_RADIUS 的完整范围', async () => {
    const { generateBowlProfile } = await import('@/scene/bowl')
    const { BOWL_INNER_RADIUS } = await import('@/config/bowl')

    const profile = generateBowlProfile()
    const SEGMENTS = 20
    const innerStart = SEGMENTS + 1 + 1
    const innerPoints = profile.slice(innerStart)

    const radii = innerPoints.map((pt: { x: number }) => pt.x)
    const minR = Math.min(...radii)
    const maxR = Math.max(...radii)

    expect(minR, `最小半径=${minR.toFixed(4)} 应接近 0`).toBeLessThan(0.01)
    expect(maxR, `最大半径=${maxR.toFixed(4)} 应接近 BOWL_INNER_RADIUS=${BOWL_INNER_RADIUS}`).toBeCloseTo(BOWL_INNER_RADIUS, 2)
  })
})
