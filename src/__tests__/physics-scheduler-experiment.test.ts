// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getPhysicsCadenceScheduler } from '@/config/physics-cadence'
import {
  DEFAULT_RUNTIME_PHYSICS_SCHEDULER_VARIANT_ID,
  getPhysicsSchedulerVariant,
  PHYSICS_SCHEDULER_EXPERIMENT_VERSION,
  PHYSICS_SCHEDULER_VARIANT_IDS,
  resolvePhysicsSchedulerExperiment,
} from '@/game/physics-scheduler-experiment'

describe('浏览器物理 scheduler 实验 preset', () => {
  it('生产默认使用 exact cap6', () => {
    expect(DEFAULT_RUNTIME_PHYSICS_SCHEDULER_VARIANT_ID).toBe('exact-cap6')
    expect(getPhysicsSchedulerVariant(DEFAULT_RUNTIME_PHYSICS_SCHEDULER_VARIANT_ID)).toEqual({
      id: 'exact-cap6',
      version: PHYSICS_SCHEDULER_EXPERIMENT_VERSION,
      kind: 'exact-accumulator',
      maxStepsPerFrame: 6,
    })
  })

  it('只接受当前版本和三个预注册 preset', () => {
    expect(PHYSICS_SCHEDULER_VARIANT_IDS).toEqual(['legacy-batched', 'exact-cap6', 'exact-cap4'])

    for (const id of PHYSICS_SCHEDULER_VARIANT_IDS) {
      expect(
        resolvePhysicsSchedulerExperiment(String(PHYSICS_SCHEDULER_EXPERIMENT_VERSION), id),
      ).toBe(getPhysicsSchedulerVariant(id))
    }

    expect(resolvePhysicsSchedulerExperiment('0', 'legacy-batched')).toBeUndefined()
    expect(resolvePhysicsSchedulerExperiment('2', 'exact-cap6')).toBeUndefined()
    expect(resolvePhysicsSchedulerExperiment('1', 'unknown')).toBeUndefined()
    expect(resolvePhysicsSchedulerExperiment(null, 'legacy-batched')).toBeUndefined()
    expect(resolvePhysicsSchedulerExperiment('1', null)).toBeUndefined()
  })

  it('exact 候选只选择 scheduler，cap 复用 physics cadence 单一真源', () => {
    const baseline = getPhysicsSchedulerVariant('legacy-batched')
    const candidateIds = ['exact-cap6', 'exact-cap4'] as const
    const candidates = candidateIds.map((id) => getPhysicsSchedulerVariant(id))

    expect(candidates.map(({ maxStepsPerFrame }) => maxStepsPerFrame)).toEqual([6, 4])

    for (const id of candidateIds) {
      const candidate = getPhysicsSchedulerVariant(id)
      expect(candidate.version).toBe(baseline.version)
      expect(Object.keys(candidate).sort()).toEqual(Object.keys(baseline).sort())
      expect(candidate.kind).toBe('exact-accumulator')
      expect(candidate.maxStepsPerFrame).toBe(getPhysicsCadenceScheduler(id).maxStepsPerFrame)
    }
  })
})
