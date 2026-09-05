import type { RollingDprPreset } from '@/config/render'
import type { RollingShadowPreset } from './rolling-shadow'

export const RENDER_PERFORMANCE_EXPERIMENT_VERSION = 1
export const DEFAULT_RUNTIME_RENDER_VARIANT_ID = 'adaptive' as const

export interface RenderPerformanceVariant {
  id: typeof DEFAULT_RUNTIME_RENDER_VARIANT_ID
  rollingDprPreset: RollingDprPreset
  rollingShadowPreset: RollingShadowPreset
}

const RUNTIME_VARIANT: Readonly<RenderPerformanceVariant> = Object.freeze({
  id: DEFAULT_RUNTIME_RENDER_VARIANT_ID,
  rollingDprPreset: 'adaptive',
  rollingShadowPreset: 'every-frame',
})

export function resolveRenderPerformanceExperiment(): undefined {
  return undefined
}

export function getRenderPerformanceVariant(): Readonly<RenderPerformanceVariant> {
  return RUNTIME_VARIANT
}
