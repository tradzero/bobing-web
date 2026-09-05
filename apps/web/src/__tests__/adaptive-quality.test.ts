import { describe, expect, it } from 'vitest'
import { createAdaptiveQuality } from '@/game/adaptive-quality'

describe('rolling 自适应分辨率', () => {
  it('持续慢帧降档、保留跨轮档位，长时间快帧才恢复', () => {
    const quality = createAdaptiveQuality()
    for (let i = 0; i < 5; i++) expect(quality.observe(80)).toBe(false)
    expect(quality.observe(80)).toBe(true)
    expect(quality.pixelRatioCap).toBe(1)
    quality.resetWindow()
    expect(quality.pixelRatioCap).toBe(1)
    for (let i = 0; i < 6; i++) quality.observe(80)
    expect(quality.pixelRatioCap).toBe(0.75)
    for (let i = 0; i < 119; i++) expect(quality.observe(16)).toBe(false)
    expect(quality.observe(16)).toBe(true)
    expect(quality.pixelRatioCap).toBe(1)
    for (let i = 0; i < 120; i++) quality.observe(16)
    expect(quality.pixelRatioCap).toBe(Infinity)
  })

  it('零时间、非法时间和零星慢帧不触发降档', () => {
    const quality = createAdaptiveQuality()
    for (let i = 0; i < 100; i++) {
      for (const delta of [NaN, Infinity, 0, -1, 80, 16]) quality.observe(delta)
    }
    expect(quality.pixelRatioCap).toBe(Infinity)
  })
})
