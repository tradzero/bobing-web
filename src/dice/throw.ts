import * as CANNON from 'cannon-es'
import type { DicePair } from './create'
import { THROW } from '@/config/throw'
import { random, randomRange } from '@/utils/random'

// ─── Slot 类型：位置 + 可选高度带 ───────────────────────────
/** fallback 布局槽位，带高度带标记用于碰撞时序分层 */
export interface Slot {
  x: number
  z: number
  /** high = 高带（晚落），low = 低带（先落）；rejection 路径为 null */
  heightBand: 'high' | 'low' | null
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

function pickLayout(): 'ring6' | 'dual33' | 'center15' {
  const roll = random() * WEIGHT_SUM
  if (roll < LAYOUT_WEIGHTS[0]) return 'ring6'
  if (roll < LAYOUT_WEIGHTS[0] + LAYOUT_WEIGHTS[1]) return 'dual33'
  return 'center15'
}

/**
 * 构造式 fallback：随机选拓扑 + 全局旋转，返回带高度带的 Slot[]
 * rBase = minSeparation * 1.02，所有布局经几何证明满足 minSeparation 约束
 */
function fallbackSlots(count: number, minSeparation: number): Slot[] {
  const rBase = minSeparation * 1.02
  const globalRotation = random() * Math.PI * 2
  const layout = pickLayout()

  if (layout === 'ring6') return ring6Slots(rBase, globalRotation)
  if (layout === 'dual33') return dual33Slots(rBase, globalRotation)
  return center15Slots(count, rBase, globalRotation)
}

/**
 * 生成一组不重叠的初始位置 Slot[]
 * rejection sampling 成功 → heightBand = null（全区间随机高度）
 * fallback → heightBand = 'high'/'low'（分层高度）
 */
function sampleSlots(count: number): Slot[] {
  const { spreadRadius, minSeparation, maxPlacementAttempts } = THROW
  const minSepSq = minSeparation * minSeparation

  // Phase 1: rejection sampling
  const placed: Slot[] = []
  let useFallback = false

  for (let i = 0; i < count; i++) {
    let accepted = false
    for (let attempt = 0; attempt < maxPlacementAttempts; attempt++) {
      const angle = random() * Math.PI * 2
      const r = random() * spreadRadius
      const cx = Math.cos(angle) * r
      const cz = Math.sin(angle) * r

      let tooClose = false
      for (const p of placed) {
        const dx = cx - p.x
        const dz = cz - p.z
        if (dx * dx + dz * dz < minSepSq) {
          tooClose = true
          break
        }
      }
      if (!tooClose) {
        placed.push({ x: cx, z: cz, heightBand: null })
        accepted = true
        break
      }
    }
    if (!accepted) {
      useFallback = true
      break
    }
  }

  // Phase 2: 构造式多拓扑 fallback（随机选布局 + 全局旋转 + 高度分层）
  if (useFallback) {
    return fallbackSlots(count, minSeparation)
  }

  return placed
}

/**
 * 为单个骰子 body 设置投掷初始条件（旋转、速度、角速度）
 * 位置由批量层 samplePositions 提供，不在此处生成
 * 纯 body 版本，不依赖 mesh，可在测试中直接复用
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

  // 同步 previousPosition，防止 broadphase 基于旧位置做碰撞检测
  body.previousPosition.copy(body.position)
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

/**
 * 投掷逻辑：批量采样不重叠的初始位置，再逐颗应用投掷状态
 * fallback 路径的骰子按高度带分层，制造碰撞时序差异
 * rejection 路径沿用全区间随机高度
 */
export function throwDice(dicePairs: DicePair[]): void {
  const slots = sampleSlots(dicePairs.length)
  for (let i = 0; i < dicePairs.length; i++) {
    const slot = slots[i]
    initThrowBody(dicePairs[i].body, slot)

    // 高度分层：仅 fallback 路径生效，覆写 initThrowBody 设置的 y
    if (slot.heightBand === 'high') {
      const y = randomRange(THROW.heightMax - 0.15, THROW.heightMax) // 1.45 ~ 1.60
      dicePairs[i].body.position.y = y
      dicePairs[i].body.previousPosition.y = y
    } else if (slot.heightBand === 'low') {
      const y = randomRange(THROW.heightMin, THROW.heightMin + 0.15) // 1.20 ~ 1.35
      dicePairs[i].body.position.y = y
      dicePairs[i].body.previousPosition.y = y
    }
    // heightBand === null (rejection 路径): initThrowBody 已用全区间，不覆写
  }
}
