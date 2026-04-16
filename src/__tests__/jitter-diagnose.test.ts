/**
 * 临时诊断：两个抖动/斜停种子
 * 追踪过程中最大倾角 + 参数变体对比
 */
import { describe, it } from 'vitest'
import { createPhysicsWorld } from '@/physics/world'
import { createBowlBodies, ESCAPE_Y } from '@/physics/bowl-body'
import { setupContactMaterials } from '@/physics/materials'
import { createDiceBody } from '@/dice/dice-body'
import { PHYSICS } from '@/config/physics'
import { SETTLE } from '@/config/settle'
import { reseed } from '@/utils/random'
import { throwDice } from '@/dice/throw'
import { readAllFacesDetailed } from '@/dice/read-face'
import * as CANNON from 'cannon-es'

/** 六面法线 */
const FACE_NORMALS = [
  new CANNON.Vec3(0, 1, 0), new CANNON.Vec3(0, -1, 0),
  new CANNON.Vec3(1, 0, 0), new CANNON.Vec3(-1, 0, 0),
  new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(0, 0, -1),
]
const UP = new CANNON.Vec3(0, 1, 0)

/** 获取 body 当前最大面法线与 UP 的余弦（confidence），返回倾角度数 */
function getMaxTiltAngle(body: CANNON.Body): number {
  let maxDot = -1
  const worldNormal = new CANNON.Vec3()
  for (const fn of FACE_NORMALS) {
    body.quaternion.vmult(fn, worldNormal)
    const d = worldNormal.dot(UP)
    if (d > maxDot) maxDot = d
  }
  return Math.acos(Math.min(1, maxDot)) * 180 / Math.PI
}

interface VariantConfig {
  label: string
  diceDiceFriction: number
  diceDiceRestitution: number
  sleepTimeLimit: number
}

const VARIANTS: VariantConfig[] = [
  { label: 'baseline (f=0.30 r=0.25)', diceDiceFriction: 0.30, diceDiceRestitution: 0.25, sleepTimeLimit: 0.32 },
  // 单因素 friction 梯度
  { label: 'f=0.27', diceDiceFriction: 0.27, diceDiceRestitution: 0.25, sleepTimeLimit: 0.32 },
  { label: 'f=0.25', diceDiceFriction: 0.25, diceDiceRestitution: 0.25, sleepTimeLimit: 0.32 },
  { label: 'f=0.22', diceDiceFriction: 0.22, diceDiceRestitution: 0.25, sleepTimeLimit: 0.32 },
  // 单因素 restitution
  { label: 'r=0.22', diceDiceFriction: 0.30, diceDiceRestitution: 0.22, sleepTimeLimit: 0.32 },
  { label: 'r=0.20', diceDiceFriction: 0.30, diceDiceRestitution: 0.20, sleepTimeLimit: 0.32 },
  // 双因素组合
  { label: 'f=0.27 r=0.22', diceDiceFriction: 0.27, diceDiceRestitution: 0.22, sleepTimeLimit: 0.32 },
  { label: 'f=0.25 r=0.22', diceDiceFriction: 0.25, diceDiceRestitution: 0.22, sleepTimeLimit: 0.32 },
  { label: 'f=0.27 r=0.20', diceDiceFriction: 0.27, diceDiceRestitution: 0.20, sleepTimeLimit: 0.32 },
]

function diagnose(seed: number, variant: VariantConfig) {
  reseed(seed)
  const { world, step, dispose } = createPhysicsWorld()

  // 手动设置材质，覆盖 variant 参数
  setupContactMaterials(world)
  // 找到 dice-dice ContactMaterial 并覆盖参数
  // cannon-es ContactMaterial 存储在 .materials 数组中
  for (const cm of world.contactmaterials) {
    const mats = (cm as any).materials as CANNON.Material[] | undefined
    const nameA = mats?.[0]?.name ?? (cm as any).materialA?.name
    const nameB = mats?.[1]?.name ?? (cm as any).materialB?.name
    if (nameA === 'dice' && nameB === 'dice') {
      cm.friction = variant.diceDiceFriction
      cm.restitution = variant.diceDiceRestitution
    }
  }

  createBowlBodies(world)
  const dicePairs = Array.from({ length: 6 }, () => {
    const body = createDiceBody()
    body.sleepTimeLimit = variant.sleepTimeLimit
    world.addBody(body)
    return { mesh: {} as any, body }
  })
  throwDice(dicePairs)
  const bodies = dicePairs.map(p => p.body)
  const dt = PHYSICS.fixedTimeStep
  let t = 0
  let settlePath = 'timeout'

  // 过程中追踪每颗骰子的最大倾角
  const peakAngles = new Array(6).fill(0)
  // 速度轨迹
  const snapshots: Array<{ t: number; maxV: number; maxAV: number; awake: number }> = []

  for (let i = 0; i < 800; i++) {
    step(dt); t += dt
    for (const { body } of dicePairs) {
      if (body.position.y > ESCAPE_Y && body.velocity.y > 0) body.velocity.y = -body.velocity.y * 0.3
    }

    // 每帧追踪 peak 倾角（前面 0.5s 是自由飞行，跳过）
    if (t > 0.5) {
      for (let d = 0; d < 6; d++) {
        const angle = getMaxTiltAngle(bodies[d])
        if (angle > peakAngles[d]) peakAngles[d] = angle
      }
    }

    if (i % 30 === 0) {
      snapshots.push({
        t,
        maxV: Math.max(...bodies.map(b => b.velocity.length())),
        maxAV: Math.max(...bodies.map(b => b.angularVelocity.length())),
        awake: bodies.filter(b => b.sleepState !== CANNON.Body.SLEEPING).length,
      })
    }
    if (bodies.every(b => b.sleepState === CANNON.Body.SLEEPING)) { settlePath = 'sleep'; break }
    if (t >= SETTLE.timeout) break
  }

  const detailed = readAllFacesDetailed(bodies)
  const finalMaxAngle = Math.max(...detailed.map(d => Math.acos(Math.min(1, d.confidence)) * 180 / Math.PI))
  const overallPeakAngle = Math.max(...peakAngles)
  const hasTilt = detailed.some(d => d.confidence < SETTLE.tiltThreshold)

  dispose()
  return { settlePath, time: t, finalMaxAngle, overallPeakAngle, hasTilt, peakAngles, snapshots }
}

const SEEDS = [
  1776310976115,  // 抖动 seed
  1776311021115,  // 抖动 seed
  1776308150130,  // tilt seed (baseline 43.5°)
  1776305112201,  // f=0.22 回归 seed (baseline 正常, f022 变 tilt)
  1776308167330,  // f=0.22 受益 seed (baseline tilt, f022 修复)
  1776305192933,  // f=0.22 慢结算 seed
]

describe('抖动种子对比诊断', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}`, { timeout: 60_000 }, () => {
      console.log(`\n=== seed ${seed} ===`)
      for (const v of VARIANTS) {
        const r = diagnose(seed, v)
        console.log(
          `  [${v.label.padEnd(28)}] ` +
          `path=${r.settlePath} time=${r.time.toFixed(2)}s ` +
          `finalMax=${r.finalMaxAngle.toFixed(1)}° ` +
          `peakMax=${r.overallPeakAngle.toFixed(1)}° ` +
          `tilt=${r.hasTilt}`
        )
      }
    })
  }
})
