import * as CANNON from 'cannon-es'
import type { DicePair } from './create'
import { THROW, type ThrowPlacementAlgorithm } from '@/config/throw'
import { syncBodyInterpolationState } from '@/physics/body-transform'
import {
  createRandomSubstream,
  getCurrentSeed,
  random,
  randomRange,
  type RandomFn,
} from '@/utils/random'

export type { ThrowPlacementAlgorithm } from '@/config/throw'

/** seed 复现记录使用；v3 新增分层环形布局。 */
export const THROW_ALGORITHM_VERSION = 3

/** 动力学单位值的消费顺序或子流 salt 改变时必须递增。 */
export const THROW_RANDOM_PLAN_VERSION = 1

/** 固定子流 salt 是 random plan 的一部分，不能在不升版本时修改。 */
const LAYOUT_RANDOM_SALT = 0x4c41594f
const DYNAMICS_RANDOM_SALT = 0x44594e41

// ─── Slot 类型：位置 + 可选高度带 ───────────────────────────
export type ThrowHeightBand = 'high' | 'low' | null

/** fallback 布局槽位，带高度带标记用于碰撞时序分层 */
export interface Slot {
  x: number
  z: number
  /** high = 高带（晚落），low = 低带（先落）；rejection 路径为 null */
  heightBand: ThrowHeightBand
}

/** fallback 使用的构造式布局 */
export type FallbackLayout = 'ring6' | 'dual33' | 'center15'

interface ThrowDiagnosticsBase {
  algorithm: ThrowPlacementAlgorithm
  /** rejection 候选点的总采样数；不包含 fallback 的旋转和布局抽签。 */
  attempts: number
  /** 已丢弃的整组布局数；uniform-area-restarts 的范围为 0..4。 */
  restarts: number
  /** 实际执行的整组布局尝试数；legacy/radial 固定为 1。 */
  groupAttempts: number
  /** legacy-v1 沿用共享随机流，因此没有 v2 random plan。 */
  randomPlanVersion: typeof THROW_RANDOM_PLAN_VERSION | null
}

/** 单次投掷的位置采样诊断，不参与投掷行为 */
export type ThrowDiagnostics = ThrowDiagnosticsBase &
  (
    | { placementPath: 'rejection' | 'constructive'; fallbackLayout: null }
    | { placementPath: 'fallback'; fallbackLayout: FallbackLayout }
  )

interface SlotSample {
  slots: Slot[]
  attempts: number
  restarts: number
  groupAttempts: number
  placementPath: ThrowDiagnostics['placementPath']
  fallbackLayout: ThrowDiagnostics['fallbackLayout']
}

interface RejectionGroupSample {
  slots: Slot[]
  attempts: number
  complete: boolean
}

export interface ThrowDiceOptions {
  /** split-stream 算法的主 seed；省略时读取 reseed() 设置的当前 seed。 */
  seed?: number
  algorithm?: ThrowPlacementAlgorithm
}

/** 每颗骰子固定消费的 10 个动力学单位值。 */
export interface ThrowDynamicsUnits {
  height: number
  quaternion: readonly [number, number, number]
  velocity: readonly [number, number, number]
  angularVelocity: readonly [number, number, number]
}

/** 与位置 sampler 无关的动力学随机计划，可用于 A/B 复现核对。 */
export interface ThrowRandomPlan {
  version: typeof THROW_RANDOM_PLAN_VERSION
  seed: number
  dice: ThrowDynamicsUnits[]
}

// ─── 三种纯几何 helper（不消费随机流，可确定性测试） ────────

/**
 * 单环 6：r = rBase, 60° 等分
 * 索引 0,2,4 → high（交替高带），1,3,5 → low
 */
export function ring6Slots(rBase: number, rotation: number): Slot[] {
  const slots: Slot[] = []
  for (let i = 0; i < 6; i++) {
    const angle = rotation + (i / 6) * Math.PI * 2
    slots.push({
      x: Math.cos(angle) * rBase,
      z: Math.sin(angle) * rBase,
      heightBand: i % 2 === 0 ? 'high' : 'low',
    })
  }
  return slots
}

/**
 * 3+3 双环：内环 rI = rBase/√3, 外环 rO = 2·rI, 交错 60°
 * 内环 → high，外环 → low
 */
export function dual33Slots(rBase: number, rotation: number): Slot[] {
  const rI = rBase / Math.sqrt(3)
  const rO = 2 * rI
  const slots: Slot[] = []
  // 内环 3 颗
  for (let i = 0; i < 3; i++) {
    const angle = rotation + (i / 3) * Math.PI * 2
    slots.push({ x: Math.cos(angle) * rI, z: Math.sin(angle) * rI, heightBand: 'high' })
  }
  // 外环 3 颗，偏移 60°
  for (let i = 0; i < 3; i++) {
    const angle = rotation + Math.PI / 3 + (i / 3) * Math.PI * 2
    slots.push({ x: Math.cos(angle) * rO, z: Math.sin(angle) * rO, heightBand: 'low' })
  }
  return slots
}

/**
 * 1+5：中心 1 颗 + 外环 rBase, 72° 等分
 * 中心 → high，外环 → low
 */
export function center15Slots(count: number, rBase: number, rotation: number): Slot[] {
  const slots: Slot[] = [{ x: 0, z: 0, heightBand: 'high' }]
  for (let i = 0; i < count - 1; i++) {
    const angle = rotation + (i / (count - 1)) * Math.PI * 2
    slots.push({ x: Math.cos(angle) * rBase, z: Math.sin(angle) * rBase, heightBand: 'low' })
  }
  return slots
}

// ─── fallback 布局选择与组装 ─────────────────────────────

/** 布局权重 [ring6, dual33, center15] = [2, 2, 1] */
const LAYOUT_WEIGHTS = [2, 2, 1] as const
const WEIGHT_SUM = LAYOUT_WEIGHTS.reduce((a, b) => a + b, 0)

function pickLayout(nextRandom: RandomFn): FallbackLayout {
  const roll = nextRandom() * WEIGHT_SUM
  if (roll < LAYOUT_WEIGHTS[0]) return 'ring6'
  if (roll < LAYOUT_WEIGHTS[0] + LAYOUT_WEIGHTS[1]) return 'dual33'
  return 'center15'
}

/**
 * 构造式 fallback：随机选拓扑 + 全局旋转，返回带高度带的 Slot[]
 * rBase = minSeparation * 1.02，所有布局经几何证明满足 minSeparation 约束
 */
function fallbackSlots(
  count: number,
  minSeparation: number,
  nextRandom: RandomFn,
): { slots: Slot[]; layout: FallbackLayout } {
  const rBase = minSeparation * 1.02
  // 保持 legacy-v1 原有的随机消费顺序：先旋转，后布局抽签。
  const globalRotation = nextRandom() * Math.PI * 2
  const layout = pickLayout(nextRandom)

  if (layout === 'ring6') return { slots: ring6Slots(rBase, globalRotation), layout }
  if (layout === 'dual33') return { slots: dual33Slots(rBase, globalRotation), layout }
  return { slots: center15Slots(count, rBase, globalRotation), layout }
}

function sampleRejectionGroup(
  count: number,
  nextRandom: RandomFn,
  areaUniform: boolean,
): RejectionGroupSample {
  const { spreadRadius, minSeparation, maxPlacementAttempts } = THROW
  const minSepSq = minSeparation * minSeparation
  const slots: Slot[] = []
  let attempts = 0

  for (let i = 0; i < count; i++) {
    let accepted = false
    for (let attempt = 0; attempt < maxPlacementAttempts; attempt++) {
      attempts++
      const angle = nextRandom() * Math.PI * 2
      const radiusUnit = nextRandom()
      const r = (areaUniform ? Math.sqrt(radiusUnit) : radiusUnit) * spreadRadius
      const cx = Math.cos(angle) * r
      const cz = Math.sin(angle) * r

      let tooClose = false
      for (const slot of slots) {
        const dx = cx - slot.x
        const dz = cz - slot.z
        if (dx * dx + dz * dz < minSepSq) {
          tooClose = true
          break
        }
      }
      if (!tooClose) {
        slots.push({ x: cx, z: cz, heightBand: null })
        accepted = true
        break
      }
    }
    if (!accepted) return { slots, attempts, complete: false }
  }

  return { slots, attempts, complete: true }
}

/** legacy-v1：一轮半径均匀 rejection，且继续消费旧的共享随机流。 */
function sampleLegacySlots(count: number): SlotSample {
  const group = sampleRejectionGroup(count, random, false)
  if (group.complete) {
    return {
      slots: group.slots,
      attempts: group.attempts,
      restarts: 0,
      groupAttempts: 1,
      placementPath: 'rejection',
      fallbackLayout: null,
    }
  }

  const fallback = fallbackSlots(count, THROW.minSeparation, random)
  return {
    slots: fallback.slots,
    attempts: group.attempts,
    restarts: 0,
    groupAttempts: 1,
    placementPath: 'fallback',
    fallbackLayout: fallback.layout,
  }
}

/** v2：位置子流独立；uniform 算法失败时整组重来，最多共尝试五组。 */
function samplePlannedSlots(
  count: number,
  algorithm: Exclude<ThrowPlacementAlgorithm, 'legacy-v1' | 'stratified-ring'>,
  nextRandom: RandomFn,
): SlotSample {
  const areaUniform = algorithm === 'uniform-area-restarts'
  const maxGroupAttempts = areaUniform ? THROW.maxPlacementGroupAttempts : 1
  let totalAttempts = 0

  for (let groupAttempt = 1; groupAttempt <= maxGroupAttempts; groupAttempt++) {
    const group = sampleRejectionGroup(count, nextRandom, areaUniform)
    totalAttempts += group.attempts
    if (group.complete) {
      return {
        slots: group.slots,
        attempts: totalAttempts,
        restarts: groupAttempt - 1,
        groupAttempts: groupAttempt,
        placementPath: 'rejection',
        fallbackLayout: null,
      }
    }
  }

  const fallback = fallbackSlots(count, THROW.minSeparation, nextRandom)
  return {
    slots: fallback.slots,
    attempts: totalAttempts,
    restarts: maxGroupAttempts - 1,
    groupAttempts: maxGroupAttempts,
    placementPath: 'fallback',
    fallbackLayout: fallback.layout,
  }
}

/**
 * 六扇区分层环：随机整体旋转，并随机打乱“骰子索引 → 槽位”的对应关系。
 * 该构造始终满足初始间距，不再让 fallback 拓扑成为多数主路径。
 */
function sampleStratifiedRingSlots(count: number, nextRandom: RandomFn): SlotSample {
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

  return {
    slots,
    attempts: 0,
    restarts: 0,
    groupAttempts: 1,
    placementPath: 'constructive',
    fallbackLayout: null,
  }
}

function tuple3(nextRandom: RandomFn): [number, number, number] {
  return [nextRandom(), nextRandom(), nextRandom()]
}

/**
 * 为指定 seed 生成与位置 sampler 无关的动力学单位值。
 * 每骰严格消费 height 1 + quaternion 3 + velocity 3 + angularVelocity 3。
 */
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

/** 同一个高度单位值按采样路径映射到 normal/high/low 区间。 */
export function mapThrowHeightUnit(unit: number, heightBand: ThrowHeightBand): number {
  if (heightBand === 'high') {
    return rangeFromUnit(unit, THROW.heightMax - 0.15, THROW.heightMax)
  }
  if (heightBand === 'low') {
    return rangeFromUnit(unit, THROW.heightMin, THROW.heightMin + 0.15)
  }
  return rangeFromUnit(unit, THROW.heightMin, THROW.heightMax)
}

function applyThrowDynamics(body: CANNON.Body, slot: Slot, units: ThrowDynamicsUnits): void {
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

  // teleport 完整 pose 后同步历史与插值状态，避免首帧从旧位置/旋转插值
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

/**
 * 为单个骰子 body 设置投掷初始条件（旋转、速度、角速度）。
 * 这是 legacy-v1 的共享随机流入口，保留旧调用与随机消费顺序。
 */
export function initThrowBody(body: CANNON.Body, pos?: { x: number; z: number }): void {
  // 唤醒骰子
  body.wakeUp()

  // 初始位置：由批量层提供或自行采样（向后兼容单颗调用）
  let px: number, pz: number
  if (pos) {
    px = pos.x
    pz = pos.z
  } else {
    const angle = random() * Math.PI * 2
    const r = random() * THROW.spreadRadius
    px = Math.cos(angle) * r
    pz = Math.sin(angle) * r
  }
  const y = randomRange(THROW.heightMin, THROW.heightMax)
  body.position.set(px, y, pz)

  // 强制更新 AABB，确保 SAPBroadphase 正确索引
  body.aabbNeedsUpdate = true

  // 随机初始旋转（均匀分布四元数）
  const u1 = random()
  const u2 = random()
  const u3 = random()
  const sqrt1MinusU1 = Math.sqrt(1 - u1)
  const sqrtU1 = Math.sqrt(u1)
  body.quaternion.set(
    sqrt1MinusU1 * Math.sin(2 * Math.PI * u2),
    sqrt1MinusU1 * Math.cos(2 * Math.PI * u2),
    sqrtU1 * Math.sin(2 * Math.PI * u3),
    sqrtU1 * Math.cos(2 * Math.PI * u3),
  )

  // teleport 完整 pose 后同步历史与插值状态，避免首帧从旧位置/旋转插值
  syncBodyInterpolationState(body)

  // 受控随机线速度（向碗中心偏移 + 向下）
  const vx = randomRange(THROW.horizontalSpeedMin, THROW.horizontalSpeedMax) - px * 0.5
  const vy = randomRange(THROW.downSpeedMin, THROW.downSpeedMax)
  const vz = randomRange(THROW.horizontalSpeedMin, THROW.horizontalSpeedMax) - pz * 0.5
  body.velocity.set(vx, vy, vz)

  // 受控随机角速度
  body.angularVelocity.set(
    randomRange(THROW.angularSpeedMin, THROW.angularSpeedMax),
    randomRange(THROW.angularSpeedMin, THROW.angularSpeedMax),
    randomRange(THROW.angularSpeedMin, THROW.angularSpeedMax),
  )
}

function throwLegacy(dicePairs: DicePair[]): ThrowDiagnostics {
  const sample = sampleLegacySlots(dicePairs.length)
  for (let i = 0; i < dicePairs.length; i++) {
    const slot = sample.slots[i]
    initThrowBody(dicePairs[i].body, slot)

    // v1 历史行为：fallback 高度覆写会额外消费一次共享随机数。
    if (slot.heightBand === 'high') {
      dicePairs[i].body.position.y = randomRange(THROW.heightMax - 0.15, THROW.heightMax)
    } else if (slot.heightBand === 'low') {
      dicePairs[i].body.position.y = randomRange(THROW.heightMin, THROW.heightMin + 0.15)
    }
    syncBodyInterpolationState(dicePairs[i].body)
  }

  return {
    algorithm: 'legacy-v1',
    attempts: sample.attempts,
    restarts: sample.restarts,
    groupAttempts: sample.groupAttempts,
    randomPlanVersion: null,
    placementPath: sample.placementPath,
    fallbackLayout: sample.fallbackLayout,
  } as ThrowDiagnostics
}

function throwPlanned(
  dicePairs: DicePair[],
  seed: number,
  algorithm: Exclude<ThrowPlacementAlgorithm, 'legacy-v1'>,
): ThrowDiagnostics {
  const layoutRandom = createRandomSubstream(seed, LAYOUT_RANDOM_SALT)
  const sample =
    algorithm === 'stratified-ring'
      ? sampleStratifiedRingSlots(dicePairs.length, layoutRandom)
      : samplePlannedSlots(dicePairs.length, algorithm, layoutRandom)
  const plan = createThrowRandomPlan(seed, dicePairs.length)

  for (let i = 0; i < dicePairs.length; i++) {
    applyThrowDynamics(dicePairs[i].body, sample.slots[i], plan.dice[i])
  }

  return {
    algorithm,
    attempts: sample.attempts,
    restarts: sample.restarts,
    groupAttempts: sample.groupAttempts,
    randomPlanVersion: plan.version,
    placementPath: sample.placementPath,
    fallbackLayout: sample.fallbackLayout,
  } as ThrowDiagnostics
}

/**
 * 批量投掷入口。
 * - legacy-v1 保留 reseed/setRandom 驱动的旧共享随机流。
 * - v2+ sampler 使用 seed 派生独立 layout/dynamics 子流；默认 stratified-ring。
 * - 没有显式 seed 且检测到 setRandom() 时回退 legacy-v1，保留旧测试/调用兼容性。
 */
export function throwDice(dicePairs: DicePair[], options: ThrowDiceOptions = {}): ThrowDiagnostics {
  const algorithm = options.algorithm ?? THROW.placementAlgorithm
  if (algorithm === 'legacy-v1') return throwLegacy(dicePairs)

  const seed = options.seed ?? getCurrentSeed()
  if (options.seed === undefined && seed === -1) {
    if (options.algorithm === undefined) return throwLegacy(dicePairs)
    throw new Error(`${algorithm} requires a seed when a custom random source is active`)
  }
  if (!Number.isFinite(seed)) throw new TypeError('throw seed must be finite')

  return throwPlanned(dicePairs, seed, algorithm)
}
