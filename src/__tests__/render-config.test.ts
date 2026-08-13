// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { RENDER_QUALITY, resolveRenderQuality } from '@/config/render'

describe('渲染质量预算', () => {
  it('小视口只应用 1.5 DPR 上限并保留 1024 阴影', () => {
    const quality = resolveRenderQuality(1280, 720, 3)

    expect(quality.pixelRatio).toBe(1.5)
    expect(quality.drawingBufferPixels).toBe(1920 * 1080)
    expect(quality.tier).toBe('full')
    expect(quality.shadowMapSize).toBe(1024)
  })

  it('大视口按 3.5MP 预算降低 DPR 和阴影档位', () => {
    const quality = resolveRenderQuality(1920, 1080, 2)

    expect(quality.pixelRatio).toBeCloseTo(
      Math.sqrt(RENDER_QUALITY.maxDrawingBufferPixels / (1920 * 1080)),
      8,
    )
    expect(quality.pixelRatio).toBeLessThan(1.5)
    expect(quality.pixelRatio).toBeGreaterThanOrEqual(1)
    expect(quality.drawingBufferPixels).toBeLessThanOrEqual(RENDER_QUALITY.maxDrawingBufferPixels)
    expect(quality.tier).toBe('reduced')
    expect(quality.shadowMapSize).toBe(512)
  })

  it('超大 CSS 视口受最低 DPR 1 保护并使用低档阴影', () => {
    const quality = resolveRenderQuality(3840, 2160, 2)

    expect(quality.pixelRatio).toBe(1)
    expect(quality.drawingBufferPixels).toBe(3840 * 2160)
    expect(quality.tier).toBe('reduced')
    expect(quality.shadowMapSize).toBe(512)
  })

  it('无效或过低设备 DPR 归一化为 1', () => {
    expect(resolveRenderQuality(800, 600, Number.NaN).pixelRatio).toBe(1)
    expect(resolveRenderQuality(800, 600, 0.75).pixelRatio).toBe(1)
  })
})
