import { getPhysicsCadenceScheduler } from '@dice/physics-core/config/physics-cadence'

export const PHYSICS_SCHEDULER_EXPERIMENT_VERSION = 1
export const DEFAULT_RUNTIME_PHYSICS_SCHEDULER_VARIANT_ID = 'exact-cap6' as const

export interface PhysicsSchedulerVariant {
  id: 'exact-cap6'
  version: typeof PHYSICS_SCHEDULER_EXPERIMENT_VERSION
  kind: 'exact-accumulator'
  maxStepsPerFrame: number
}

const maxStepsPerFrame = getPhysicsCadenceScheduler('exact-cap6').maxStepsPerFrame
if (maxStepsPerFrame === null) throw new Error('exact-cap6 必须配置有限的单帧步数上限')

const RUNTIME_VARIANT: Readonly<PhysicsSchedulerVariant> = Object.freeze({
  id: 'exact-cap6',
  version: PHYSICS_SCHEDULER_EXPERIMENT_VERSION,
  kind: 'exact-accumulator',
  maxStepsPerFrame,
})

export function resolvePhysicsSchedulerExperiment(): undefined {
  return undefined
}

export function getPhysicsSchedulerVariant(): Readonly<PhysicsSchedulerVariant> {
  return RUNTIME_VARIANT
}
