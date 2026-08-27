import type { ThrowPlacementAlgorithm } from './throw'

/** A/B preset 的结构版本；字段语义变化时递增。 */
export const PHYSICS_VARIANT_SCHEMA_VERSION = 2

export type PhysicsVariantId =
  | 'historical'
  | 'placement-control'
  | 'placement-candidate'
  | 'natural-control'
  | 'current'

export interface PhysicsVariant {
  id: PhysicsVariantId
  version: number
  throwPlacementAlgorithm: ThrowPlacementAlgorithm
  contactClusterAssistEnabled: boolean
  poseStableWindowEnabled: boolean
}

function variant(
  id: PhysicsVariantId,
  throwPlacementAlgorithm: ThrowPlacementAlgorithm,
  contactClusterAssistEnabled: boolean,
  poseStableWindowEnabled: boolean,
): Readonly<PhysicsVariant> {
  return Object.freeze({
    id,
    version: 2,
    throwPlacementAlgorithm,
    contactClusterAssistEnabled,
    poseStableWindowEnabled,
  })
}

/**
 * 命名 preset 固定 A/B 的完整行为组合，避免 CLI 临时拼参数后无法复现。
 */
export const PHYSICS_VARIANTS: Readonly<Record<PhysicsVariantId, Readonly<PhysicsVariant>>> =
  Object.freeze({
    historical: variant('historical', 'legacy-v1', true, false),
    'placement-control': variant('placement-control', 'uniform-area-restarts', false, false),
    'placement-candidate': variant('placement-candidate', 'stratified-ring', false, false),
    'natural-control': variant('natural-control', 'legacy-v1', false, false),
    current: variant('current', 'stratified-ring', false, true),
  })

export const PHYSICS_VARIANT_IDS = Object.freeze(
  Object.keys(PHYSICS_VARIANTS) as PhysicsVariantId[],
)

export function isPhysicsVariantId(value: string): value is PhysicsVariantId {
  return Object.prototype.hasOwnProperty.call(PHYSICS_VARIANTS, value)
}

export function getPhysicsVariant(id: string): Readonly<PhysicsVariant> {
  if (!isPhysicsVariantId(id)) {
    throw new RangeError(`未知 physics variant: ${id}；可选值：${PHYSICS_VARIANT_IDS.join(', ')}`)
  }
  return PHYSICS_VARIANTS[id]
}
