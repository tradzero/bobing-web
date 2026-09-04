import * as CANNON from 'cannon-es'
import { THROW, type ThrowPlacementAlgorithm } from '../config/throw'
import { syncBodyInterpolationState } from '../physics/body-interpolation'
import { createRandomSubstream, getCurrentSeed, type RandomFn } from '../random'

export type { ThrowPlacementAlgorithm } from '../config/throw'

export interface ThrowBodyPair {
  body: CANNON.Body
}

/** seed 复现记录使用；v3 新增分层环形布局。 */
export const THROW_ALGORITHM_VERSION = 3

/** 动力学单位值的消费顺序或子流 salt 改变时必须递增。 */
export const THROW_RANDOM_PLAN_VERSION = 1

/** 固定子流 salt 是 random plan 的一部分，不能在不升版本时修改。 */
export const THROW_LAYOUT_RANDOM_SALT = 0x4c41594f
const DYNAMICS_RANDOM_SALT = 0x44594e41

export type ThrowHeightBand = 'high' | 'low' | null

export interface Slot {
  x: number
  z: number
  heightBand: ThrowHeightBand
}

export type FallbackLayout = 'ring6' | 'dual33' | 'center15'

export type ThrowDiagnostics = {
  algorithm: ThrowPlacementAlgorithm
  attempts: number
  restarts: number
  groupAttempts: number
  randomPlanVersion: typeof THROW_RANDOM_PLAN_VERSION | null
} & (
  | { placementPath: 'rejection' | 'constructive'; fallbackLayout: null }
  | { placementPath: 'fallback'; fallbackLayout: FallbackLayout }
)

export interface ThrowDiceOptions {
  seed?: number
  algorithm?: ThrowPlacementAlgorithm
}

export interface ThrowDynamicsUnits {
  height: number
  quaternion: readonly [number, number, number]
  velocity: readonly [number, number, number]
  angularVelocity: readonly [number, number, number]
}

export interface ThrowRandomPlan {
  version: typeof THROW_RANDOM_PLAN_VERSION
  seed: number
  dice: ThrowDynamicsUnits[]
}

function tuple3(nextRandom: RandomFn): [number, number, number] {
  return [nextRandom(), nextRandom(), nextRandom()]
}

export function createThrowRandomPlan(seed: number, diceCount: number): ThrowRandomPlan {
  if (!Number.isFinite(seed)) throw new TypeError('throw seed must be finite')
  if (!Number.isInteger(diceCount) || diceCount < 0) {
    throw new RangeError('diceCount must be a non-negative integer')
  }

  const nextRandom = createRandomSubstream(seed, DYNAMICS_RANDOM_SALT)
  const dice: ThrowDynamicsUnits[] = []
  for (let i = 0; i < diceCount; i++) {
    dice.push({
      height: nextRandom(),
      quaternion: tuple3(nextRandom),
      velocity: tuple3(nextRandom),
      angularVelocity: tuple3(nextRandom),
    })
  }
  return { version: THROW_RANDOM_PLAN_VERSION, seed, dice }
}

function rangeFromUnit(unit: number, min: number, max: number): number {
  return min + unit * (max - min)
}

export function mapThrowHeightUnit(unit: number, heightBand: ThrowHeightBand): number {
  if (heightBand === 'high') {
    return rangeFromUnit(unit, THROW.heightMax - 0.15, THROW.heightMax)
  }
  if (heightBand === 'low') {
    return rangeFromUnit(unit, THROW.heightMin, THROW.heightMin + 0.15)
  }
  return rangeFromUnit(unit, THROW.heightMin, THROW.heightMax)
}

export function applyThrowDynamics(body: CANNON.Body, slot: Slot, units: ThrowDynamicsUnits): void {
  body.wakeUp()
  body.position.set(slot.x, mapThrowHeightUnit(units.height, slot.heightBand), slot.z)
  body.aabbNeedsUpdate = true

  const [u1, u2, u3] = units.quaternion
  const sqrt1MinusU1 = Math.sqrt(1 - u1)
  const sqrtU1 = Math.sqrt(u1)
  body.quaternion.set(
    sqrt1MinusU1 * Math.sin(2 * Math.PI * u2),
    sqrt1MinusU1 * Math.cos(2 * Math.PI * u2),
    sqrtU1 * Math.sin(2 * Math.PI * u3),
    sqrtU1 * Math.cos(2 * Math.PI * u3),
  )
  syncBodyInterpolationState(body)

  const [vxUnit, vyUnit, vzUnit] = units.velocity
  body.velocity.set(
    rangeFromUnit(vxUnit, THROW.horizontalSpeedMin, THROW.horizontalSpeedMax) - slot.x * 0.5,
    rangeFromUnit(vyUnit, THROW.downSpeedMin, THROW.downSpeedMax),
    rangeFromUnit(vzUnit, THROW.horizontalSpeedMin, THROW.horizontalSpeedMax) - slot.z * 0.5,
  )

  const [avxUnit, avyUnit, avzUnit] = units.angularVelocity
  body.angularVelocity.set(
    rangeFromUnit(avxUnit, THROW.angularSpeedMin, THROW.angularSpeedMax),
    rangeFromUnit(avyUnit, THROW.angularSpeedMin, THROW.angularSpeedMax),
    rangeFromUnit(avzUnit, THROW.angularSpeedMin, THROW.angularSpeedMax),
  )
}

function sampleStratifiedRingSlots(count: number, nextRandom: RandomFn): Slot[] {
  if (count !== 6) {
    throw new RangeError(`stratified-ring requires exactly 6 dice, received ${count}`)
  }

  const rotation = nextRandom() * Math.PI * 2
  const slots = Array.from({ length: count }, (_, index): Slot => {
    const angle = rotation + (index / count) * Math.PI * 2
    return {
      x: Math.cos(angle) * THROW.stratifiedRingRadius,
      z: Math.sin(angle) * THROW.stratifiedRingRadius,
      heightBand: null,
    }
  })

  for (let index = slots.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(nextRandom() * (index + 1))
    ;[slots[index], slots[swapIndex]] = [slots[swapIndex], slots[index]]
  }
  return slots
}

export function throwStratifiedRing(dicePairs: ThrowBodyPair[], seed: number): ThrowDiagnostics {
  if (!Number.isFinite(seed)) throw new TypeError('throw seed must be finite')
  const layoutRandom = createRandomSubstream(seed, THROW_LAYOUT_RANDOM_SALT)
  const slots = sampleStratifiedRingSlots(dicePairs.length, layoutRandom)
  const plan = createThrowRandomPlan(seed, dicePairs.length)
  for (let i = 0; i < dicePairs.length; i++) {
    applyThrowDynamics(dicePairs[i].body, slots[i], plan.dice[i])
  }
  return {
    algorithm: 'stratified-ring',
    attempts: 0,
    restarts: 0,
    groupAttempts: 1,
    randomPlanVersion: plan.version,
    placementPath: 'constructive',
    fallbackLayout: null,
  }
}

/** 生产投掷入口只接受当前 stratified-ring 算法。 */
export function throwDice(
  dicePairs: ThrowBodyPair[],
  options: ThrowDiceOptions = {},
): ThrowDiagnostics {
  const algorithm = options.algorithm ?? THROW.placementAlgorithm
  if (algorithm !== 'stratified-ring') {
    throw new RangeError(`${algorithm} is available only from the physics lab entry`)
  }
  const seed = options.seed ?? getCurrentSeed()
  if (seed === -1)
    throw new Error('stratified-ring requires a seed when a custom random source is active')
  return throwStratifiedRing(dicePairs, seed)
}
