/**
 * 共享试验运行器
 * 封装物理世界创建 → 投掷 → 步进 → 结算 → 读面 的通用流程
 */
import * as CANNON from 'cannon-es'
import { createPhysicsWorld, type SolverMode } from '@/physics/world'
import { createBowlBodies, ESCAPE_Y } from '@/physics/bowl-body'
import { setupContactMaterials, type ContactMaterialOverrides } from '@/physics/materials'
import { createDiceBody, type DiceBodyOptions, type ShapeMode } from '@/dice/dice-body'
import { PHYSICS } from '@/config/physics'
import { SETTLE } from '@/config/settle'
import { reseed } from '@/utils/random'
import { throwDice } from '@/dice/throw'
import { readAllFacesDetailed, type FaceReadResult } from '@/dice/read-face'

export type SettlePath = 'sleep' | 'threshold' | 'timeout'

/**
 * sweep 层保留独立的 chamfer 基线，避免运行时默认回退 box 后影响历史对照脚本。
 */
export const DEFAULT_SWEEP_CHAMFER_RATIO = 0.15

export interface TrialConfig {
  seed: number
  maxFrames?: number
  shapeMode?: ShapeMode
  /** 覆盖倒角比例；配合 shapeMode='chamfer' 使用 */
  chamferRatio?: number
  /** 覆盖碗底 restitution；仅影响 dice-bowlFloor 接触材质 */
  floorRestitution?: number
  /** 覆盖 dice-dice 摩擦系数 */
  diceDiceFriction?: number
  /** 覆盖 dice-dice 弹性系数 */
  diceDiceRestitution?: number
  /** 覆盖 dice-dice 接触方程刚度 */
  diceDiceContactEquationStiffness?: number
  /** 覆盖 dice-dice 接触方程松弛 */
  diceDiceContactEquationRelaxation?: number
  /** 覆盖 dice-dice 摩擦方程刚度 */
  diceDiceFrictionEquationStiffness?: number
  /** 覆盖 dice-dice 摩擦方程松弛 */
  diceDiceFrictionEquationRelaxation?: number
  /** 覆盖 sleepTimeLimit */
  sleepTimeLimit?: number
  /** 覆盖线性阻尼 */
  linearDamping?: number
  /** 覆盖角阻尼 */
  angularDamping?: number
  /** 试验 solver 类型 */
  solverMode?: SolverMode
  /** 覆盖 solver 迭代次数 */
  solverIterations?: number
  /** 覆盖 solver 收敛容差 */
  solverTolerance?: number
  /** 每帧回调（用于自定义追踪，如 peak 倾角） */
  onFrame?: (frame: number, time: number, bodies: CANNON.Body[]) => void
}

export interface TrialResult {
  seed: number
  settlePath: SettlePath
  settleTime: number
  settleFrame: number
  allSleepTime: number
  allSleepFrame: number
  stableBrokenCount: number
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
    chamferRatio,
    floorRestitution,
    diceDiceFriction,
    diceDiceRestitution,
    diceDiceContactEquationStiffness,
    diceDiceContactEquationRelaxation,
    diceDiceFrictionEquationStiffness,
    diceDiceFrictionEquationRelaxation,
    sleepTimeLimit,
    linearDamping,
    angularDamping,
    solverMode,
    solverIterations,
    solverTolerance,
    onFrame,
  } = config

  reseed(seed)
  const { world, step, dispose } = createPhysicsWorld({
    solverMode,
    solverIterations,
    solverTolerance,
  })

  const contactOverrides: ContactMaterialOverrides = {}
  if (floorRestitution !== undefined) {
    contactOverrides.diceFloor = { restitution: floorRestitution }
  }

  const diceDiceOverrides: NonNullable<ContactMaterialOverrides['diceDice']> = {}
  if (diceDiceFriction !== undefined) diceDiceOverrides.friction = diceDiceFriction
  if (diceDiceRestitution !== undefined) diceDiceOverrides.restitution = diceDiceRestitution
  if (diceDiceContactEquationStiffness !== undefined) {
    diceDiceOverrides.contactEquationStiffness = diceDiceContactEquationStiffness
  }
  if (diceDiceContactEquationRelaxation !== undefined) {
    diceDiceOverrides.contactEquationRelaxation = diceDiceContactEquationRelaxation
  }
  if (diceDiceFrictionEquationStiffness !== undefined) {
    diceDiceOverrides.frictionEquationStiffness = diceDiceFrictionEquationStiffness
  }
  if (diceDiceFrictionEquationRelaxation !== undefined) {
    diceDiceOverrides.frictionEquationRelaxation = diceDiceFrictionEquationRelaxation
  }
  if (
    diceDiceFriction !== undefined ||
    diceDiceRestitution !== undefined ||
    diceDiceContactEquationStiffness !== undefined ||
    diceDiceContactEquationRelaxation !== undefined ||
    diceDiceFrictionEquationStiffness !== undefined ||
    diceDiceFrictionEquationRelaxation !== undefined
  ) {
    contactOverrides.diceDice = diceDiceOverrides
  }
  setupContactMaterials(world, Object.keys(contactOverrides).length > 0 ? contactOverrides : undefined)

  createBowlBodies(world)
  const dicePairs = Array.from({ length: 6 }, () => {
    const bodyOpts: DiceBodyOptions = {}
    if (shapeMode) bodyOpts.shapeMode = shapeMode
    if (chamferRatio !== undefined) bodyOpts.chamferRatio = chamferRatio
    else if (shapeMode === 'chamfer') bodyOpts.chamferRatio = DEFAULT_SWEEP_CHAMFER_RATIO
    const body = createDiceBody(Object.keys(bodyOpts).length > 0 ? bodyOpts : undefined)
    if (sleepTimeLimit !== undefined) body.sleepTimeLimit = sleepTimeLimit
    if (linearDamping !== undefined) body.linearDamping = linearDamping
    if (angularDamping !== undefined) body.angularDamping = angularDamping
    world.addBody(body)
    return { mesh: {} as any, body }
  })
  throwDice(dicePairs)
  const bodies = dicePairs.map((p) => p.body)

  const dt = PHYSICS.fixedTimeStep
  let t = 0
  let settlePath: SettlePath = 'timeout'
  let settleFrame = -1
  let allSleepTime = -1
  let allSleepFrame = -1
  let stableBrokenCount = 0
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
      allSleepTime = t
      allSleepFrame = i
      settlePath = 'sleep'
      settleFrame = i
      break
    }
    if (t >= SETTLE.timeout) {
      settleFrame = i
      break
    }

    const allBelow = bodies.every(
      (b) =>
        b.velocity.length() < SETTLE.speedThreshold &&
        b.angularVelocity.length() < SETTLE.angularThreshold,
    )
    if (allBelow) {
      if (stableState.stableStartTime < 0) stableState.stableStartTime = t
      else if (t - stableState.stableStartTime >= SETTLE.stableDuration) {
        settlePath = 'threshold'
        settleFrame = i
        break
      }
    } else {
      if (stableState.stableStartTime >= 0) stableBrokenCount++
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
  return {
    seed,
    settlePath,
    settleTime: t,
    settleFrame,
    allSleepTime,
    allSleepFrame,
    stableBrokenCount,
    tiltCount,
    maxTiltAngle,
    faces,
  }
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
