/**
 * 固定 seed 比较三种位置采样器的 fallback 率。
 * legacy-v1 的精确计数同时作为旧共享随机流/几何消费顺序的复现门禁。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { resetRandom, reseed } from '@dice/physics-core/random'
import { createDiceBody } from '@dice/physics-core/dice/dice-body'
import type { DicePair } from '@/dice/create'
import {
  throwDice,
  type FallbackLayout,
  type ThrowPlacementAlgorithm,
} from '@dice/physics-core/dice/throw'

interface RateResult {
  fallbackCount: number
  rejectionCount: number
  fallbackLayoutCounts: Record<FallbackLayout, number>
}

function makeDicePairs(): DicePair[] {
  return Array.from({ length: 6 }, () => ({
    mesh: {} as DicePair['mesh'],
    body: createDiceBody(),
  }))
}

function measureFallbackRate(algorithm: ThrowPlacementAlgorithm, trials: number): RateResult {
  const dicePairs = makeDicePairs()
  const result: RateResult = {
    fallbackCount: 0,
    rejectionCount: 0,
    fallbackLayoutCounts: { ring6: 0, dual33: 0, center15: 0 },
  }

  for (let trial = 0; trial < trials; trial++) {
    const seed = trial * 1000
    // legacy-v1 的契约仍是 reseed() 后消费共享随机流。
    if (algorithm === 'legacy-v1') reseed(seed)
    const diagnostics = throwDice(dicePairs, { seed, algorithm })
    expect(diagnostics.algorithm).toBe(algorithm)
    if (diagnostics.placementPath === 'fallback') {
      result.fallbackCount++
      result.fallbackLayoutCounts[diagnostics.fallbackLayout]++
    } else {
      result.rejectionCount++
      expect(diagnostics.fallbackLayout).toBeNull()
    }
  }
  return result
}

describe('fallback 触发率', () => {
  afterEach(() => {
    resetRandom()
  })

  it('legacy-v1 固定 1000 seeds 精确复现旧基线', () => {
    const result = measureFallbackRate('legacy-v1', 1000)

    expect(result.fallbackCount).toBe(592)
    expect(result.rejectionCount).toBe(408)
    expect(result.fallbackLayoutCounts).toEqual({ ring6: 228, dual33: 250, center15: 114 })
  })

  it('uniform-area-restarts 将固定 1000 seeds 的 fallback 压到 5% 以下', () => {
    const result = measureFallbackRate('uniform-area-restarts', 1000)

    expect(result.fallbackCount + result.rejectionCount).toBe(1000)
    expect(result.fallbackCount).toBeGreaterThan(0)
    expect(result.fallbackCount).toBeLessThanOrEqual(50)
    // 相对旧基线至少降低 90%，避免仅靠放宽绝对预算过门禁。
    expect(result.fallbackCount).toBeLessThanOrEqual(Math.floor(592 * 0.1))
    expect(result.fallbackLayoutCounts.ring6).toBeGreaterThan(0)
    expect(result.fallbackLayoutCounts.dual33).toBeGreaterThan(0)
    expect(result.fallbackLayoutCounts.center15).toBeGreaterThan(0)
  })

  it('radial-rejection 可单独选择且仍保留一轮采样基线', () => {
    const result = measureFallbackRate('radial-rejection', 1000)

    expect(result.fallbackCount + result.rejectionCount).toBe(1000)
    expect(result.fallbackCount).toBeGreaterThan(400)
    expect(result.fallbackCount).toBeLessThan(750)
  })

  it('stratified-ring 是构造式主路径，固定样本不触发 fallback', () => {
    const result = measureFallbackRate('stratified-ring', 1000)

    expect(result).toEqual({
      fallbackCount: 0,
      rejectionCount: 1000,
      fallbackLayoutCounts: { ring6: 0, dual33: 0, center15: 0 },
    })
  })

  it('未指定算法时使用 stratified-ring 默认值', () => {
    const pairs = makeDicePairs()
    reseed(123456)

    const diagnostics = throwDice(pairs)

    expect(diagnostics.algorithm).toBe('stratified-ring')
    expect(diagnostics.placementPath).toBe('constructive')
  })
})
