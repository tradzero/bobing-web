import * as CANNON from 'cannon-es'
import { PHYSICS } from '../config/physics'
import { WALL_RADIUS, WALL_THICKNESS } from './bowl-body'

/** 骰子中心到物理挡墙内表面的半径。 */
export const WALL_INNER_RADIUS = WALL_RADIUS - WALL_THICKNESS / 2

/**
 * 当前 Box 骰子在任意姿态下的包围球半径。
 * 用它计算保守 containment 边界，避免只检查中心是否越过挡墙。
 */
export const DICE_BOUNDING_RADIUS = PHYSICS.diceHalfSize * Math.sqrt(3)

/** 骰子中心完全处于挡墙内侧时允许的最大水平半径。 */
export const CONSERVATIVE_DICE_CENTER_RADIUS = WALL_INNER_RADIUS - DICE_BOUNDING_RADIUS

export interface RollFrameDiagnostics {
  maxRadius: number
  maxHeight: number
  maxSpeed: number
  maxAngularSpeed: number
  maxContactPenetration: number
  conservativeBoundaryCrossings: number
  wallCenterCrossings: number
  nanDetected: boolean
}

/** 为一轮物理模拟创建逐帧累积诊断。 */
export function createRollFrameDiagnostics(): RollFrameDiagnostics {
  return {
    maxRadius: 0,
    maxHeight: -Infinity,
    maxSpeed: 0,
    maxAngularSpeed: 0,
    maxContactPenetration: 0,
    conservativeBoundaryCrossings: 0,
    wallCenterCrossings: 0,
    nanDetected: false,
  }
}

function contactPenetration(contact: CANNON.ContactEquation): number {
  const pointA = contact.bi.position.vadd(contact.ri)
  const pointB = contact.bj.position.vadd(contact.rj)
  const delta = pointB.vsub(pointA)
  return Math.max(0, -contact.ni.dot(delta))
}

/** 采样刚体姿态/速度包络；可在 teleport 后、首个 world.step 前安全调用。 */
export function sampleRollBodyDiagnostics(
  diagnostics: RollFrameDiagnostics,
  bodies: CANNON.Body[],
): void {
  for (const body of bodies) {
    const { x, y, z } = body.position
    const finite = [
      x,
      y,
      z,
      body.quaternion.x,
      body.quaternion.y,
      body.quaternion.z,
      body.quaternion.w,
      body.velocity.x,
      body.velocity.y,
      body.velocity.z,
      body.angularVelocity.x,
      body.angularVelocity.y,
      body.angularVelocity.z,
    ].every(Number.isFinite)
    if (!finite) diagnostics.nanDetected = true

    const radius = Math.hypot(x, z)
    diagnostics.maxRadius = Math.max(diagnostics.maxRadius, radius)
    diagnostics.maxHeight = Math.max(diagnostics.maxHeight, y)
    diagnostics.maxSpeed = Math.max(diagnostics.maxSpeed, body.velocity.length())
    diagnostics.maxAngularSpeed = Math.max(
      diagnostics.maxAngularSpeed,
      body.angularVelocity.length(),
    )
    if (radius > CONSERVATIVE_DICE_CENTER_RADIUS) diagnostics.conservativeBoundaryCrossings++
    if (radius > WALL_RADIUS) diagnostics.wallCenterCrossings++
  }
}

function sampleRollContactDiagnostics(
  diagnostics: RollFrameDiagnostics,
  world: CANNON.World,
): void {
  for (const contact of world.contacts) {
    diagnostics.maxContactPenetration = Math.max(
      diagnostics.maxContactPenetration,
      contactPenetration(contact),
    )
  }
}

/**
 * 在每个物理步之后采样一次。这里只记录事实，不改变刚体状态。
 * contact 必须来自刚完成的同一 world.step，不能与 teleport 后的新 body pose 混用。
 */
export function sampleRollFrameDiagnostics(
  diagnostics: RollFrameDiagnostics,
  bodies: CANNON.Body[],
  world: CANNON.World,
): void {
  sampleRollBodyDiagnostics(diagnostics, bodies)
  sampleRollContactDiagnostics(diagnostics, world)
}
