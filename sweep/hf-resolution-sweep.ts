/**
 * Heightfield 分辨率对比 sweep
 *
 * 对比 51 / 81 / 101 三档 HF_GRID_SIZE
 * 同时记录物理效果和性能门槛
 *
 * 检验：
 * - 阶段 B: stable broken 次数是否下降
 * - 阶段 A: 主问题骰子最大二次抬升是否下降
 * - 性能: 物理步进耗时
 */
import * as CANNON from 'cannon-es'
import { createPhysicsWorld } from '@/physics/world'
import {
  BOWL_RADIUS,
  WALL_COUNT,
  WALL_RADIUS,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WALL_BURY,
  ESCAPE_Y,
  bowlCurveHeight,
} from '@/physics/bowl-body'
import {
  bowlFloorMaterial,
  bowlWallMaterial,
  tableMaterial,
  setupContactMaterials,
} from '@/physics/materials'
import { createDiceBody } from '@/dice/dice-body'
import type { DicePair } from '@/dice/create'
import { PHYSICS } from '@/config/physics'
import { SETTLE } from '@/config/settle'
import { reseed } from '@/utils/random'
import { throwDice } from '@/dice/throw'

const GRID_SIZES = [51, 81, 101]
const SEEDS = [
  1776390018022, 42, 1, 7777, 12345, 99999, 314159, 65535, 271828, 5555, 666, 11111, 54321, 777777,
  31337, 13, 9999999, 123456789, 2024, 8888,
]

/**
 * 自定义网格大小的碗碰撞体创建
 * 复制 bowl-body.ts 逻辑，但 gridSize 可变
 */
function createBowlBodiesWithGrid(world: CANNON.World, gridSize: number) {
  const extent = BOWL_RADIUS * 2
  const elementSize = extent / (gridSize - 1)
  const center = extent / 2

  let minHeight = Infinity
  const data: number[][] = []

  for (let i = 0; i < gridSize; i++) {
    const row: number[] = []
    for (let j = 0; j < gridSize; j++) {
      const dx = i * elementSize - center
      const dz = j * elementSize - center
      const d = Math.sqrt(dx * dx + dz * dz)
      const h = bowlCurveHeight(d)
      if (h < minHeight) minHeight = h
      row.push(h)
    }
    data.push(row)
  }

  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      data[i][j] -= minHeight
    }
  }

  const hfShape = new CANNON.Heightfield(data, { elementSize })
  const bottom = new CANNON.Body({ mass: 0, material: bowlFloorMaterial })
  bottom.addShape(hfShape)
  bottom.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
  bottom.position.set(-BOWL_RADIUS, 0, BOWL_RADIUS)
  world.addBody(bottom)

  // 挡墙
  const wallTangentialHalf = (((2 * Math.PI * WALL_RADIUS) / WALL_COUNT) * 1.15) / 2
  const hfEdgeH = bowlCurveHeight(WALL_RADIUS) - minHeight
  const wallCenterY = hfEdgeH - WALL_BURY + WALL_HEIGHT / 2

  for (let i = 0; i < WALL_COUNT; i++) {
    const angle = (i / WALL_COUNT) * Math.PI * 2
    const x = Math.sin(angle) * WALL_RADIUS
    const z = Math.cos(angle) * WALL_RADIUS
    const wall = new CANNON.Body({
      mass: 0,
      material: bowlWallMaterial,
      position: new CANNON.Vec3(x, wallCenterY, z),
    })
    wall.addShape(
      new CANNON.Box(new CANNON.Vec3(wallTangentialHalf, WALL_HEIGHT / 2, WALL_THICKNESS / 2)),
    )
    wall.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle)
    world.addBody(wall)
  }

  // 桌面
  const table = new CANNON.Body({
    mass: 0,
    material: tableMaterial,
    position: new CANNON.Vec3(0, -0.075, 0),
  })
  table.addShape(new CANNON.Plane())
  table.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
  world.addBody(table)
}

interface SeedResult {
  maxYRise: number
  stableBroken: number
  sleepTime: number
  stepTimeMs: number // 物理步进总耗时 (ms)
}

function runSeed(seed: number, gridSize: number): SeedResult {
  reseed(seed)
  const { world, step, dispose } = createPhysicsWorld()
  setupContactMaterials(world)
  createBowlBodiesWithGrid(world, gridSize)

  const dicePairs = Array.from({ length: 6 }, () => {
    const body = createDiceBody()
    world.addBody(body)
    return { mesh: {} as DicePair['mesh'], body }
  })
  throwDice(dicePairs)
  const bodies = dicePairs.map((p) => p.body)

  const dt = PHYSICS.fixedTimeStep
  const maxFrames = 1200

  const post100MinY = new Array(6).fill(Infinity)
  const post100MaxY = new Array(6).fill(-Infinity)

  let allSleepFrame = -1
  let allSleepTime = -1
  let stableStart = -1
  let stableBrokenCount = 0
  let settledFrame = -1

  const t0 = performance.now()

  for (let f = 0; f < maxFrames; f++) {
    step(dt)
    const t = (f + 1) * dt

    for (const { body } of dicePairs) {
      if (body.position.y > ESCAPE_Y && body.velocity.y > 0) {
        body.velocity.y = -body.velocity.y * 0.3
      }
    }

    if (f >= 100) {
      for (let i = 0; i < 6; i++) {
        const y = bodies[i].position.y
        if (y < post100MinY[i]) post100MinY[i] = y
        if (y > post100MaxY[i]) post100MaxY[i] = y
      }
    }

    if (allSleepFrame < 0 && bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING)) {
      allSleepFrame = f
      allSleepTime = t
      if (settledFrame < 0) settledFrame = f
    }

    const allBelow = bodies.every(
      (b) =>
        b.velocity.length() < SETTLE.speedThreshold &&
        b.angularVelocity.length() < SETTLE.angularThreshold,
    )
    if (allBelow) {
      if (stableStart < 0) stableStart = t
      else if (settledFrame < 0 && t - stableStart >= SETTLE.stableDuration) settledFrame = f
    } else {
      if (stableStart >= 0) {
        stableBrokenCount++
        stableStart = -1
      }
    }

    if (settledFrame < 0 && t >= SETTLE.timeout) settledFrame = f
    if (settledFrame >= 0 && f > settledFrame + 100) break
    if (allSleepFrame >= 0 && f > allSleepFrame + 200) break
  }

  const stepTimeMs = performance.now() - t0
  const yDeltas = bodies.map((_, i) => post100MaxY[i] - post100MinY[i])

  dispose()

  return {
    maxYRise: Math.max(...yDeltas),
    stableBroken: stableBrokenCount,
    sleepTime: allSleepTime,
    stepTimeMs,
  }
}

// ─── Main ──────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════╗')
console.log('║       HF 分辨率对比 sweep (20 seeds)               ║')
console.log('╚══════════════════════════════════════════════════╝\n')

for (const grid of GRID_SIZES) {
  const elementSize = (BOWL_RADIUS * 2) / (grid - 1)
  console.log(`\n═══ HF_GRID_SIZE=${grid}  elementSize=${elementSize.toFixed(4)}m ═══`)

  const results = SEEDS.map((seed) => runSeed(seed, grid))
  const rises = results.map((r) => r.maxYRise)
  const brokens = results.map((r) => r.stableBroken)
  const sleeps = results.map((r) => r.sleepTime).filter((t) => t >= 0)
  const stepTimes = results.map((r) => r.stepTimeMs)

  const bounceCount = rises.filter((y) => y > 0.01).length
  const sorted = [...rises].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const p90 = sorted[Math.floor(sorted.length * 0.9)]
  const max = sorted[sorted.length - 1]
  const avgSleep = sleeps.reduce((a, b) => a + b, 0) / sleeps.length
  const avgBroken = brokens.reduce((a, b) => a + b, 0) / brokens.length
  const avgStepTime = stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length
  const maxStepTime = Math.max(...stepTimes)

  console.log(
    `  明显弹跳(>10mm): ${bounceCount}/${SEEDS.length} (${((bounceCount / SEEDS.length) * 100).toFixed(0)}%)`,
  )
  console.log(
    `  maxYRise: median=${(median * 1000).toFixed(1)}mm, p90=${(p90 * 1000).toFixed(1)}mm, max=${(max * 1000).toFixed(1)}mm`,
  )
  console.log(`  avg sleepTime: ${avgSleep.toFixed(2)}s`)
  console.log(`  avg stableBroken: ${avgBroken.toFixed(1)}`)
  console.log(
    `  性能: avg=${avgStepTime.toFixed(0)}ms, max=${maxStepTime.toFixed(0)}ms (per seed full sim)`,
  )
  console.log(`  逐 seed maxYRise: ${rises.map((y) => (y * 1000).toFixed(0) + 'mm').join(', ')}`)
}

// seed 1776390018022 单独详细对比
console.log('\n═══ seed=1776390018022 单独对比 ═══')
for (const grid of GRID_SIZES) {
  const r = runSeed(1776390018022, grid)
  console.log(
    `  grid=${grid}: maxYRise=${(r.maxYRise * 1000).toFixed(1)}mm, broken=${r.stableBroken}, sleep=${r.sleepTime >= 0 ? r.sleepTime.toFixed(2) + 's' : 'N/A'}, step=${r.stepTimeMs.toFixed(0)}ms`,
  )
}

console.log('\n基线对照: BOX die3=3.0mm, die4=1.4mm')
console.log('chamfer feature scale: ~0.025m')
console.log('grid51=0.052m, grid81=0.033m, grid101=0.026m')
