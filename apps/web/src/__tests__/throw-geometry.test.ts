/**
 * 纯几何 helper 确定性测试
 * 不依赖随机流，直接断言 pairwise 间距 ≥ minSeparation + heightBand 标记正确
 */
import { describe, it, expect } from 'vitest'
import { center15Slots, dual33Slots, ring6Slots, throwDice } from '@dice/physics-core/dice/throw'
import { THROW } from '@dice/physics-core/config/throw'
import { createDiceBody } from '@dice/physics-core/dice/dice-body'
import type { DicePair } from '@/dice/create'

const minSep = THROW.minSeparation
const rBase = minSep * 1.02

/** 计算所有 slot 对之间的水平距离，返回最小值 */
function minPairwiseDist(slots: Array<{ x: number; z: number }>): number {
  let minDist = Infinity
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const dx = slots[i].x - slots[j].x
      const dz = slots[i].z - slots[j].z
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist < minDist) minDist = dist
    }
  }
  return minDist
}

// 多种 rotation 覆盖，确保任意朝向都满足约束
const rotations = [0, Math.PI / 6, Math.PI / 3, Math.PI / 2, Math.PI, 1.23, 4.56]

function makeDicePairs(): DicePair[] {
  return Array.from({ length: 6 }, () => ({
    mesh: {} as DicePair['mesh'],
    body: createDiceBody(),
  }))
}

describe('ring6Slots 几何约束', () => {
  for (const rot of rotations) {
    it(`rotation=${rot.toFixed(2)}: pairwise ≥ minSeparation`, () => {
      const slots = ring6Slots(rBase, rot)
      expect(slots).toHaveLength(6)
      expect(minPairwiseDist(slots)).toBeGreaterThanOrEqual(minSep - 0.001)
    })
  }

  it('heightBand 交替: 0,2,4=high 1,3,5=low', () => {
    const slots = ring6Slots(rBase, 0)
    expect(slots[0].heightBand).toBe('high')
    expect(slots[1].heightBand).toBe('low')
    expect(slots[2].heightBand).toBe('high')
    expect(slots[3].heightBand).toBe('low')
    expect(slots[4].heightBand).toBe('high')
    expect(slots[5].heightBand).toBe('low')
  })
})

describe('dual33Slots 几何约束', () => {
  for (const rot of rotations) {
    it(`rotation=${rot.toFixed(2)}: pairwise ≥ minSeparation`, () => {
      const slots = dual33Slots(rBase, rot)
      expect(slots).toHaveLength(6)
      expect(minPairwiseDist(slots)).toBeGreaterThanOrEqual(minSep - 0.001)
    })
  }

  it('heightBand: 内环=high 外环=low', () => {
    const slots = dual33Slots(rBase, 0)
    // 前 3 颗内环
    expect(slots[0].heightBand).toBe('high')
    expect(slots[1].heightBand).toBe('high')
    expect(slots[2].heightBand).toBe('high')
    // 后 3 颗外环
    expect(slots[3].heightBand).toBe('low')
    expect(slots[4].heightBand).toBe('low')
    expect(slots[5].heightBand).toBe('low')
  })
})

describe('center15Slots 几何约束', () => {
  for (const rot of rotations) {
    it(`rotation=${rot.toFixed(2)}: pairwise ≥ minSeparation`, () => {
      const slots = center15Slots(6, rBase, rot)
      expect(slots).toHaveLength(6)
      expect(minPairwiseDist(slots)).toBeGreaterThanOrEqual(minSep - 0.001)
    })
  }

  it('heightBand: 中心=high 外环=low', () => {
    const slots = center15Slots(6, rBase, 0)
    expect(slots[0].heightBand).toBe('high')
    for (let i = 1; i < 6; i++) {
      expect(slots[i].heightBand).toBe('low')
    }
  })
})

describe('uniform-area-restarts 诊断计数', () => {
  it('固定 seed 精确记录每轮失败产生的 attempts 与 restarts', () => {
    const diagnostics = throwDice(makeDicePairs(), {
      seed: 1000,
      algorithm: 'uniform-area-restarts',
    })

    expect(diagnostics).toMatchObject({
      algorithm: 'uniform-area-restarts',
      attempts: 221,
      restarts: 4,
      groupAttempts: 5,
      randomPlanVersion: 1,
      placementPath: 'rejection',
      fallbackLayout: null,
    })
  })

  it('五轮均失败后才进入 fallback，且不把 fallback 抽签计入 attempts', () => {
    const diagnostics = throwDice(makeDicePairs(), {
      seed: 55000,
      algorithm: 'uniform-area-restarts',
    })

    expect(diagnostics).toMatchObject({
      attempts: 280,
      restarts: 4,
      groupAttempts: 5,
      placementPath: 'fallback',
      fallbackLayout: 'center15',
    })
  })

  it('固定 seed 样本始终遵守 5 轮组尝试与候选采样预算', () => {
    const pairs = makeDicePairs()
    for (let seed = 0; seed < 100; seed++) {
      const diagnostics = throwDice(pairs, { seed, algorithm: 'uniform-area-restarts' })
      expect(diagnostics.restarts).toBe(diagnostics.groupAttempts - 1)
      expect(diagnostics.restarts).toBeLessThanOrEqual(4)
      expect(diagnostics.groupAttempts).toBeLessThanOrEqual(THROW.maxPlacementGroupAttempts)
      expect(diagnostics.attempts).toBeGreaterThanOrEqual(6 * diagnostics.groupAttempts)
      expect(diagnostics.attempts).toBeLessThanOrEqual(
        6 * THROW.maxPlacementAttempts * diagnostics.groupAttempts,
      )
      if (diagnostics.placementPath === 'fallback') {
        expect(diagnostics.groupAttempts).toBe(THROW.maxPlacementGroupAttempts)
      }
    }
  })
})

describe('stratified-ring 构造约束', () => {
  it('固定 seed 始终形成随机旋转的六扇区环，且诊断不伪装成 rejection', () => {
    const pairs = makeDicePairs()
    const diagnostics = throwDice(pairs, { seed: 72000, algorithm: 'stratified-ring' })

    expect(diagnostics).toMatchObject({
      algorithm: 'stratified-ring',
      placementPath: 'constructive',
      attempts: 0,
      restarts: 0,
      groupAttempts: 1,
      fallbackLayout: null,
    })
    for (const { body } of pairs) {
      expect(Math.hypot(body.position.x, body.position.z)).toBeCloseTo(
        THROW.stratifiedRingRadius,
        12,
      )
    }
    expect(minPairwiseDist(pairs.map(({ body }) => body.position))).toBeCloseTo(
      THROW.stratifiedRingRadius,
      12,
    )
  })
})
