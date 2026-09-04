/** 渲染质量预算：优先限制高分辨率设备上的 fill-rate 和显存压力。 */
export const RENDER_QUALITY = {
  /** 默认设备像素比上限。 */
  maxPixelRatio: 1.5,
  /** 保证画面至少按 1x CSS 像素渲染。 */
  minPixelRatio: 1,
  /** drawing buffer 目标像素预算；超大视口受最低 DPR 约束时允许超过。 */
  maxDrawingBufferPixels: 3_500_000,
  /** 未触发像素预算降级时使用的阴影贴图尺寸。 */
  fullShadowMapSize: 1024,
  /** 触发像素预算降级时使用的阴影贴图尺寸。 */
  reducedShadowMapSize: 512,
} as const

/** 只影响 Three.js 骰子网格，不进入共享物理配置。 */
export const DICE_RENDER = {
  chamferRatio: 0.14,
} as const

export type RenderQualityTier = 'full' | 'reduced'
export type RenderPhase = 'static' | 'rolling'
export type RollingDprPreset = 'baseline' | 'cap-1x' | 'cap-1x-reduced-tier'

export interface RenderQuality {
  pixelRatio: number
  drawingBufferPixels: number
  tier: RenderQualityTier
  shadowMapSize: 1024 | 512
}

/**
 * 只改变 rolling 主画布的有效 DPR，不反向参与基础质量与阴影档位计算。
 * 这样 A/B 的唯一变量是 drawing buffer 分辨率，而不是伪造设备 DPR 后连带改变阴影。
 */
export function resolveRenderPhasePixelRatio(
  basePixelRatio: number,
  baseTier: RenderQualityTier,
  phase: RenderPhase,
  rollingDprPreset: RollingDprPreset,
): number {
  const shouldCapRollingDpr =
    phase === 'rolling' &&
    (rollingDprPreset === 'cap-1x' ||
      (rollingDprPreset === 'cap-1x-reduced-tier' && baseTier === 'reduced'))

  if (shouldCapRollingDpr) {
    return Math.min(basePixelRatio, RENDER_QUALITY.minPixelRatio)
  }
  return basePixelRatio
}

function positiveFiniteOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * 根据 CSS 视口和设备 DPR 计算本帧渲染质量。
 * 纯函数便于在无 WebGL 环境下锁定 DPR、像素预算和阴影档位。
 */
export function resolveRenderQuality(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): RenderQuality {
  const width = positiveFiniteOr(cssWidth, 1)
  const height = positiveFiniteOr(cssHeight, 1)
  const deviceRatio = positiveFiniteOr(devicePixelRatio, RENDER_QUALITY.minPixelRatio)
  const requestedRatio = Math.min(
    RENDER_QUALITY.maxPixelRatio,
    Math.max(RENDER_QUALITY.minPixelRatio, deviceRatio),
  )
  const cssPixels = width * height
  const budgetRatio = Math.sqrt(RENDER_QUALITY.maxDrawingBufferPixels / cssPixels)
  const pixelRatio = Math.max(RENDER_QUALITY.minPixelRatio, Math.min(requestedRatio, budgetRatio))
  const budgetLimited =
    cssPixels * requestedRatio * requestedRatio > RENDER_QUALITY.maxDrawingBufferPixels
  const drawingBufferPixels = Math.floor(width * pixelRatio) * Math.floor(height * pixelRatio)

  return budgetLimited
    ? {
        pixelRatio,
        drawingBufferPixels,
        tier: 'reduced',
        shadowMapSize: RENDER_QUALITY.reducedShadowMapSize,
      }
    : {
        pixelRatio,
        drawingBufferPixels,
        tier: 'full',
        shadowMapSize: RENDER_QUALITY.fullShadowMapSize,
      }
}
