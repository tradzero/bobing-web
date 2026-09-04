export const PHYSICS_COLLISION_EXPERIMENT_VERSION = 1
export const DEFAULT_RUNTIME_PHYSICS_COLLISION_VARIANT_ID = 'cannon-default' as const

export interface PhysicsCollisionVariant {
  id: 'cannon-default'
  version: typeof PHYSICS_COLLISION_EXPERIMENT_VERSION
  heightfieldNarrowphaseMode: 'cannon-default'
}

const RUNTIME_VARIANT: Readonly<PhysicsCollisionVariant> = Object.freeze({
  id: 'cannon-default',
  version: PHYSICS_COLLISION_EXPERIMENT_VERSION,
  heightfieldNarrowphaseMode: 'cannon-default',
})

export function resolvePhysicsCollisionExperiment(): undefined {
  return undefined
}

export function getPhysicsCollisionVariant(): Readonly<PhysicsCollisionVariant> {
  return RUNTIME_VARIANT
}
