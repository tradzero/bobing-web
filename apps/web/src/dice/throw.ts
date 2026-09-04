import * as CANNON from 'cannon-es'
import { THROW, type ThrowPlacementAlgorithm } from '@/config/throw'
import { syncBodyInterpolationState } from '@/physics/body-interpolation'
import {
  createRandomSubstream,
  getCurrentSeed,
  random,
  randomRange,
  type RandomFn,
} from '@/utils/random'
import {
  THROW_LAYOUT_RANDOM_SALT,
  applyThrowDynamics,
  createThrowRandomPlan,
  throwStratifiedRing,
  type FallbackLayout,
  type Slot,
  type ThrowDiagnostics,
  type ThrowBodyPair,
  type ThrowDiceOptions,
} from './throw-runtime'

export type { ThrowPlacementAlgorithm } from '@/config/throw'
export {
  THROW_ALGORITHM_VERSION,
  THROW_RANDOM_PLAN_VERSION,
  createThrowRandomPlan,
  mapThrowHeightUnit,
  type FallbackLayout,
  type Slot,
  type ThrowDiagnostics,
  type ThrowBodyPair,
  type ThrowDiceOptions,
  type ThrowDynamicsUnits,
  type ThrowHeightBand,
  type ThrowRandomPlan,
} from './throw-runtime'

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

function throwLegacy(dicePairs: ThrowBodyPair[]): ThrowDiagnostics {
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
  dicePairs: ThrowBodyPair[],
  seed: number,
  algorithm: Exclude<ThrowPlacementAlgorithm, 'legacy-v1'>,
): ThrowDiagnostics {
  if (algorithm === 'stratified-ring') return throwStratifiedRing(dicePairs, seed)
  const layoutRandom = createRandomSubstream(seed, THROW_LAYOUT_RANDOM_SALT)
  const sample = samplePlannedSlots(dicePairs.length, algorithm, layoutRandom)
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
export function throwDice(
  dicePairs: ThrowBodyPair[],
  options: ThrowDiceOptions = {},
): ThrowDiagnostics {
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
