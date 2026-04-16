/**
 * 纯几何 helper 确定性测试
 * 不依赖随机流，直接断言 pairwise 间距 ≥ minSeparation + heightBand 标记正确
 */
import { describe, it, expect } from 'vitest'
import { ring6Slots, dual33Slots, center15Slots } from '@/dice/throw'
import { THROW } from '@/config/throw'

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
