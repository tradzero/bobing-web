import * as CANNON from 'cannon-es'
import type { DicePair } from './create'
import { THROW } from '@/config/throw'
import { random, randomRange } from '@/utils/random'

/**
 * 生成一组不重叠的初始水平位置 (x, z)
 * 使用 rejection sampling + 确定性 fallback（扇区均分），保证任意两颗骰子间距 >= minSeparation
 */
function samplePositions(count: number): Array<{ x: number; z: number }> {
  const { spreadRadius, minSeparation, maxPlacementAttempts } = THROW
  const minSepSq = minSeparation * minSeparation

  // Phase 1: rejection sampling
  const placed: Array<{ x: number; z: number }> = []
  let useFallback = false

  for (let i = 0; i < count; i++) {
    let accepted = false
    for (let attempt = 0; attempt < maxPlacementAttempts; attempt++) {
      const angle = random() * Math.PI * 2
      const r = random() * spreadRadius
      const cx = Math.cos(angle) * r
      const cz = Math.sin(angle) * r

      // 检查与已放置骰子的最小距离
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
        placed.push({ x: cx, z: cz })
        accepted = true
        break
      }
    }
    if (!accepted) {
      useFallback = true
      break
    }
  }

  // Phase 2: 确定性 fallback — 扇区均分
  // 6 扇区相邻距离 = 2r*sin(π/6) = r，取 r = max(minSep, spreadRadius*0.6) 保证间距
  if (useFallback) {
    placed.length = 0
    const r = Math.max(minSeparation * 1.02, spreadRadius * 0.6)
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      placed.push({ x: Math.cos(angle) * r, z: Math.sin(angle) * r })
    }
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
 * 骰子从碗上方散布投入，保证任意两颗间距 >= THROW.minSeparation
 */
export function throwDice(dicePairs: DicePair[]): void {
  const positions = samplePositions(dicePairs.length)
  for (let i = 0; i < dicePairs.length; i++) {
    initThrowBody(dicePairs[i].body, positions[i])
  }
}
