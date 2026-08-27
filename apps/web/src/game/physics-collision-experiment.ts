/** 碰撞窄相实验字段或语义变化时必须递增。 */
export const PHYSICS_COLLISION_EXPERIMENT_VERSION = 1

export type PhysicsCollisionVariantId = 'cannon-default' | 'projected-aabb-v1'

export interface PhysicsCollisionVariant {
  id: PhysicsCollisionVariantId
  version: typeof PHYSICS_COLLISION_EXPERIMENT_VERSION
  heightfieldNarrowphaseMode: PhysicsCollisionVariantId
}

function variant(id: PhysicsCollisionVariantId): Readonly<PhysicsCollisionVariant> {
  return Object.freeze({
    id,
    version: PHYSICS_COLLISION_EXPERIMENT_VERSION,
    heightfieldNarrowphaseMode: id,
  })
}

const VARIANTS: Readonly<Record<PhysicsCollisionVariantId, Readonly<PhysicsCollisionVariant>>> =
  Object.freeze({
    'cannon-default': variant('cannon-default'),
    'projected-aabb-v1': variant('projected-aabb-v1'),
  })

export const PHYSICS_COLLISION_VARIANT_IDS = Object.freeze(
  Object.keys(VARIANTS) as PhysicsCollisionVariantId[],
)

/** 生产保持 Cannon 原窄相；候选必须先通过隔离浏览器 A/B。 */
export const DEFAULT_RUNTIME_PHYSICS_COLLISION_VARIANT_ID: PhysicsCollisionVariantId =
  'cannon-default'

/**
 * 只解析版本化、预注册的碰撞实验。是否允许读取 URL 由调用方按 Vite mode 决定。
 */
export function resolvePhysicsCollisionExperiment(
  rawVersion: string | null,
  rawVariant: string | null,
): Readonly<PhysicsCollisionVariant> | undefined {
  if (rawVersion !== String(PHYSICS_COLLISION_EXPERIMENT_VERSION) || !rawVariant) {
    return undefined
  }
  if (!Object.hasOwn(VARIANTS, rawVariant)) return undefined

  return VARIANTS[rawVariant as PhysicsCollisionVariantId]
}

export function getPhysicsCollisionVariant(
  id: PhysicsCollisionVariantId,
): Readonly<PhysicsCollisionVariant> {
  return VARIANTS[id]
}
