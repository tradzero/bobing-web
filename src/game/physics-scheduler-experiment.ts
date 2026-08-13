import { getPhysicsCadenceScheduler } from '@/config/physics-cadence'

/** preset 字段或调度语义变化时必须递增。 */
export const PHYSICS_SCHEDULER_EXPERIMENT_VERSION = 1

export type PhysicsSchedulerVariantId = 'legacy-batched' | 'exact-cap6' | 'exact-cap4'

export type PhysicsSchedulerVariant =
  | Readonly<{
      id: 'legacy-batched'
      version: typeof PHYSICS_SCHEDULER_EXPERIMENT_VERSION
      kind: 'legacy-batched'
      maxStepsPerFrame: null
    }>
  | Readonly<{
      id: 'exact-cap6' | 'exact-cap4'
      version: typeof PHYSICS_SCHEDULER_EXPERIMENT_VERSION
      kind: 'exact-accumulator'
      maxStepsPerFrame: number
    }>

type ExactPhysicsSchedulerVariantId = Exclude<PhysicsSchedulerVariantId, 'legacy-batched'>

function exactVariant(id: ExactPhysicsSchedulerVariantId): PhysicsSchedulerVariant {
  const maxStepsPerFrame = getPhysicsCadenceScheduler(id).maxStepsPerFrame
  if (maxStepsPerFrame === null) {
    throw new Error(`exact scheduler ${id} 必须配置有限的单帧步数上限`)
  }

  return Object.freeze({
    id,
    version: PHYSICS_SCHEDULER_EXPERIMENT_VERSION,
    kind: 'exact-accumulator',
    maxStepsPerFrame,
  })
}

const VARIANTS: Readonly<Record<PhysicsSchedulerVariantId, Readonly<PhysicsSchedulerVariant>>> =
  Object.freeze({
    'legacy-batched': Object.freeze({
      id: 'legacy-batched',
      version: PHYSICS_SCHEDULER_EXPERIMENT_VERSION,
      kind: 'legacy-batched',
      maxStepsPerFrame: null,
    }),
    'exact-cap6': exactVariant('exact-cap6'),
    'exact-cap4': exactVariant('exact-cap4'),
  })

export const PHYSICS_SCHEDULER_VARIANT_IDS = Object.freeze(
  Object.keys(VARIANTS) as PhysicsSchedulerVariantId[],
)

/** 生产运行时在显式接线前始终保持 Cannon 旧 batched 调度。 */
export const DEFAULT_RUNTIME_PHYSICS_SCHEDULER_VARIANT_ID: PhysicsSchedulerVariantId =
  'legacy-batched'

/**
 * 只解析版本化、预注册的物理调度实验。是否允许读取 URL 由后续调用方按 Vite mode 决定。
 */
export function resolvePhysicsSchedulerExperiment(
  rawVersion: string | null,
  rawVariant: string | null,
): Readonly<PhysicsSchedulerVariant> | undefined {
  if (rawVersion !== String(PHYSICS_SCHEDULER_EXPERIMENT_VERSION) || !rawVariant) {
    return undefined
  }
  if (!Object.hasOwn(VARIANTS, rawVariant)) return undefined

  return VARIANTS[rawVariant as PhysicsSchedulerVariantId]
}

export function getPhysicsSchedulerVariant(
  id: PhysicsSchedulerVariantId,
): Readonly<PhysicsSchedulerVariant> {
  return VARIANTS[id]
}
