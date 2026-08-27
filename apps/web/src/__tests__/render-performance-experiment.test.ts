// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RUNTIME_RENDER_VARIANT_ID,
  getRenderPerformanceVariant,
  RENDER_PERFORMANCE_EXPERIMENT_VERSION,
  resolveRenderPerformanceExperiment,
} from '@/game/render-performance-experiment'

describe('浏览器渲染性能实验 preset', () => {
  it('只接受当前版本和预注册 preset', () => {
    expect(
      resolveRenderPerformanceExperiment(
        String(RENDER_PERFORMANCE_EXPERIMENT_VERSION),
        'rolling-dpr-1x',
      ),
    ).toEqual({
      id: 'rolling-dpr-1x',
      rollingDprPreset: 'cap-1x',
      rollingShadowPreset: 'every-frame',
    })

    expect(resolveRenderPerformanceExperiment('0', 'rolling-dpr-1x')).toBeUndefined()
    expect(resolveRenderPerformanceExperiment('1', 'unknown')).toBeUndefined()
    expect(resolveRenderPerformanceExperiment('1', 'rolling-dpr-reduced-tier')).toBeUndefined()
    expect(resolveRenderPerformanceExperiment(null, 'baseline')).toBeUndefined()
  })

  it('每个候选相对 baseline 只改变一个变量', () => {
    const baseline = getRenderPerformanceVariant('baseline')
    const candidates = [
      getRenderPerformanceVariant('rolling-dpr-1x'),
      getRenderPerformanceVariant('shadow-alternate'),
      getRenderPerformanceVariant('shadow-frozen'),
    ]

    for (const candidate of candidates) {
      const changedFields = (['rollingDprPreset', 'rollingShadowPreset'] as const).filter(
        (field) => candidate[field] !== baseline[field],
      )
      expect(changedFields, candidate.id).toHaveLength(1)
    }
  })

  it('生产默认仅在 reduced 档 rolling 限为 1x，阴影仍逐帧刷新', () => {
    expect(DEFAULT_RUNTIME_RENDER_VARIANT_ID).toBe('rolling-dpr-reduced-tier')
    expect(getRenderPerformanceVariant(DEFAULT_RUNTIME_RENDER_VARIANT_ID)).toEqual({
      id: 'rolling-dpr-reduced-tier',
      rollingDprPreset: 'cap-1x-reduced-tier',
      rollingShadowPreset: 'every-frame',
    })
  })
})
