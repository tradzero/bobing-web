import type { RollingDprPreset } from '@/config/render'
import type { RollingShadowPreset } from './rolling-shadow'

export const RENDER_PERFORMANCE_EXPERIMENT_VERSION = 1

export interface RenderPerformanceVariant {
  id: RenderPerformanceVariantId
  rollingDprPreset: RollingDprPreset
  rollingShadowPreset: RollingShadowPreset
}

const VARIANTS = {
  adaptive: {
    rollingDprPreset: 'adaptive',
    rollingShadowPreset: 'every-frame',
  },
  baseline: {
    rollingDprPreset: 'baseline',
    rollingShadowPreset: 'every-frame',
  },
  'rolling-dpr-1x': {
    rollingDprPreset: 'cap-1x',
    rollingShadowPreset: 'every-frame',
  },
  'rolling-dpr-reduced-tier': {
    rollingDprPreset: 'cap-1x-reduced-tier',
    rollingShadowPreset: 'every-frame',
  },
  'shadow-alternate': {
    rollingDprPreset: 'baseline',
    rollingShadowPreset: 'alternate',
  },
  'shadow-frozen': {
    rollingDprPreset: 'baseline',
    rollingShadowPreset: 'frozen-after-first',
  },
} as const satisfies Record<
  string,
  { rollingDprPreset: RollingDprPreset; rollingShadowPreset: RollingShadowPreset }
>

export type RenderPerformanceVariantId = keyof typeof VARIANTS

const EXPLICIT_EXPERIMENT_VARIANT_IDS = new Set<RenderPerformanceVariantId>([
  'baseline',
  'rolling-dpr-1x',
  'shadow-alternate',
  'shadow-frozen',
])

/** 正式渲染根据持续慢帧自适应降档，静态阶段恢复基础 DPR。 */
export const DEFAULT_RUNTIME_RENDER_VARIANT_ID: RenderPerformanceVariantId = 'adaptive'

/**
 * 只解析版本化、预注册的浏览器性能实验，避免 query string 变成任意运行时调参入口。
 * 是否允许读取 URL 由调用方根据 Vite mode 决定。
 */
export function resolveRenderPerformanceExperiment(
  rawVersion: string | null,
  rawVariant: string | null,
): RenderPerformanceVariant | undefined {
  if (rawVersion !== String(RENDER_PERFORMANCE_EXPERIMENT_VERSION) || !rawVariant) {
    return undefined
  }
  if (!Object.hasOwn(VARIANTS, rawVariant)) return undefined

  const id = rawVariant as RenderPerformanceVariantId
  // 生产默认不是 v1 A/B 候选，显式 URL 仍只允许原有四个预注册变体。
  if (!EXPLICIT_EXPERIMENT_VARIANT_IDS.has(id)) return undefined
  return { id, ...VARIANTS[id] }
}

export function getRenderPerformanceVariant(
  id: RenderPerformanceVariantId,
): RenderPerformanceVariant {
  return { id, ...VARIANTS[id] }
}
