import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROLLING_SHADOW_PRESET,
  ROLLING_SHADOW_PRESETS,
  createRollingShadowScheduler,
  type RollingShadowPreset,
} from '@/game/rolling-shadow'

describe('rolling shadow scheduler', () => {
  it('默认使用 every-frame', () => {
    const scheduler = createRollingShadowScheduler()

    expect(DEFAULT_ROLLING_SHADOW_PRESET).toBe('every-frame')
    expect(Array.from({ length: 5 }, () => scheduler.requestForRollingRender())).toEqual([
      true,
      true,
      true,
      true,
      true,
    ])
    expect(scheduler.snapshot()).toEqual({
      version: 1,
      preset: 'every-frame',
      rollingRenderFrameCount: 5,
      rollingShadowUpdateRequestCount: 5,
      maxConsecutiveRollingFramesWithoutShadowUpdateRequest: 0,
    })
  })

  it.each<[RollingShadowPreset, boolean[], number, number]>([
    ['every-frame', [true, true, true, true, true, true], 6, 0],
    ['alternate', [true, false, true, false, true, false], 3, 1],
    ['frozen-after-first', [true, false, false, false, false, false], 1, 5],
  ])('%s 只按真实 rolling render 的索引决定请求', (preset, expected, requests, maxSkipped) => {
    const scheduler = createRollingShadowScheduler(preset)

    expect(expected.map(() => scheduler.requestForRollingRender())).toEqual(expected)
    expect(scheduler.snapshot()).toMatchObject({
      preset,
      rollingRenderFrameCount: expected.length,
      rollingShadowUpdateRequestCount: requests,
      maxConsecutiveRollingFramesWithoutShadowUpdateRequest: maxSkipped,
    })
  })

  it.each(ROLLING_SHADOW_PRESETS)('%s 每轮 reset 后都重新强制请求首帧', (preset) => {
    const scheduler = createRollingShadowScheduler(preset)
    scheduler.requestForRollingRender()
    scheduler.requestForRollingRender()

    scheduler.reset()

    expect(scheduler.snapshot()).toMatchObject({
      rollingRenderFrameCount: 0,
      rollingShadowUpdateRequestCount: 0,
      maxConsecutiveRollingFramesWithoutShadowUpdateRequest: 0,
    })
    expect(scheduler.requestForRollingRender()).toBe(true)
  })
})
