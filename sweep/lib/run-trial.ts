/**
 * 共享试验运行器
 * 封装物理世界创建 → 投掷 → 步进 → 结算 → 读面 的通用流程
 */
import * as CANNON from 'cannon-es'
import { createPhysicsWorld } from '@/physics/world'
import { createBowlBodies, ESCAPE_Y } from '@/physics/bowl-body'
import { setupContactMaterials } from '@/physics/materials'
import { createDiceBody, type ShapeMode } from '@/dice/dice-body'
import { PHYSICS } from '@/config/physics'
import { SETTLE } from '@/config/settle'
import { reseed } from '@/utils/random'
import { throwDice } from '@/dice/throw'
import { readAllFacesDetailed, type FaceReadResult } from '@/dice/read-face'

export type SettlePath = 'sleep' | 'threshold' | 'timeout'

export interface TrialConfig {
  seed: number
  maxFrames?: number
  shapeMode?: ShapeMode
  /** 覆盖 dice-dice 摩擦系数 */
  diceDiceFriction?: number
  /** 覆盖 dice-dice 弹性系数 */
  diceDiceRestitution?: number
  /** 覆盖 sleepTimeLimit */
  sleepTimeLimit?: number
  /** 每帧回调（用于自定义追踪，如 peak 倾角） */
  onFrame?: (frame: number, time: number, bodies: CANNON.Body[]) => void
}

export interface TrialResult {
  seed: number
  settlePath: SettlePath
  settleTime: number
  tiltCount: number
  maxTiltAngle: number
  faces: FaceReadResult[]
}

/**
 * 运行单次试验
 */
export function runTrial(config: TrialConfig): TrialResult {
  const {
    seed,
    maxFrames = 800,
    shapeMode,
    diceDiceFriction,
    diceDiceRestitution,
    sleepTimeLimit,
    onFrame,
  } = config

  reseed(seed)
  const { world, step, dispose } = createPhysicsWorld()
  setupContactMaterials(world)

  // 覆盖 dice-dice ContactMaterial 参数
  if (diceDiceFriction !== undefined || diceDiceRestitution !== undefined) {
    for (const cm of world.contactmaterials) {
      const mats = (cm as any).materials as CANNON.Material[] | undefined
      const nameA = mats?.[0]?.name ?? (cm as any).materialA?.name
      const nameB = mats?.[1]?.name ?? (cm as any).materialB?.name
      if (nameA === 'dice' && nameB === 'dice') {
        if (diceDiceFriction !== undefined) cm.friction = diceDiceFriction
        if (diceDiceRestitution !== undefined) cm.restitution = diceDiceRestitution
      }
    }
  }

  createBowlBodies(world)
  const dicePairs = Array.from({ length: 6 }, () => {
    const body = createDiceBody(shapeMode ? { shapeMode } : undefined)
    if (sleepTimeLimit !== undefined) body.sleepTimeLimit = sleepTimeLimit
    world.addBody(body)
    return { mesh: {} as any, body }
  })
  throwDice(dicePairs)
  const bodies = dicePairs.map((p) => p.body)

  const dt = PHYSICS.fixedTimeStep
  let t = 0
  let settlePath: SettlePath = 'timeout'
  const stableState = { stableStartTime: -1 }

  for (let i = 0; i < maxFrames; i++) {
    step(dt)
    t += dt

    // 逃逸反射
    for (const { body } of dicePairs) {
      if (body.position.y > ESCAPE_Y && body.velocity.y > 0) {
        body.velocity.y = -body.velocity.y * 0.3
      }
    }

    // 自定义帧回调
    if (onFrame) onFrame(i, t, bodies)

    // 结算检测
    if (bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING)) {
      settlePath = 'sleep'
      break
    }
    if (t >= SETTLE.timeout) break

    const allBelow = bodies.every(
      (b) =>
        b.velocity.length() < SETTLE.speedThreshold &&
        b.angularVelocity.length() < SETTLE.angularThreshold,
    )
    if (allBelow) {
      if (stableState.stableStartTime < 0) stableState.stableStartTime = t
      else if (t - stableState.stableStartTime >= SETTLE.stableDuration) {
        settlePath = 'threshold'
        break
      }
    } else {
      stableState.stableStartTime = -1
    }
  }

  const faces = readAllFacesDetailed(bodies)
  let tiltCount = 0
  let maxTiltAngle = 0
  for (const d of faces) {
    if (d.confidence < SETTLE.tiltThreshold) {
      tiltCount++
      const angle = Math.acos(Math.min(1, d.confidence)) * (180 / Math.PI)
      if (angle > maxTiltAngle) maxTiltAngle = angle
    }
  }

  dispose()
  return { seed, settlePath, settleTime: t, tiltCount, maxTiltAngle, faces }
}

/**
 * 简易 CLI 参数解析
 * 支持 --key=value 和 --flag 格式
 */
export function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {}
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--(\w[\w-]*)(?:=(.*))?$/)
    if (m) args[m[1]] = m[2] ?? 'true'
  }
  return args
}

/**
 * 格式化耗时
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = ((ms % 60_000) / 1000).toFixed(0)
  return `${m}m${s}s`
}
