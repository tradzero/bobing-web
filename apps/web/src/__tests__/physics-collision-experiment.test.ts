// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RUNTIME_PHYSICS_COLLISION_VARIANT_ID,
  getPhysicsCollisionVariant,
  PHYSICS_COLLISION_EXPERIMENT_VERSION,
  PHYSICS_COLLISION_VARIANT_IDS,
  resolvePhysicsCollisionExperiment,
} from '@/game/physics-collision-experiment'

describe('浏览器物理碰撞实验 preset', () => {
  it('生产默认保持 Cannon 原窄相', () => {
    expect(DEFAULT_RUNTIME_PHYSICS_COLLISION_VARIANT_ID).toBe('cannon-default')
    expect(getPhysicsCollisionVariant(DEFAULT_RUNTIME_PHYSICS_COLLISION_VARIANT_ID)).toEqual({
      id: 'cannon-default',
      version: PHYSICS_COLLISION_EXPERIMENT_VERSION,
      heightfieldNarrowphaseMode: 'cannon-default',
    })
  })

  it('只接受当前版本和两个预注册候选', () => {
    expect(PHYSICS_COLLISION_VARIANT_IDS).toEqual(['cannon-default', 'projected-aabb-v1'])

    for (const id of PHYSICS_COLLISION_VARIANT_IDS) {
      expect(
        resolvePhysicsCollisionExperiment(String(PHYSICS_COLLISION_EXPERIMENT_VERSION), id),
      ).toBe(getPhysicsCollisionVariant(id))
    }

    expect(resolvePhysicsCollisionExperiment('0', 'cannon-default')).toBeUndefined()
    expect(resolvePhysicsCollisionExperiment('2', 'projected-aabb-v1')).toBeUndefined()
    expect(resolvePhysicsCollisionExperiment('1', 'unknown')).toBeUndefined()
    expect(resolvePhysicsCollisionExperiment(null, 'cannon-default')).toBeUndefined()
    expect(resolvePhysicsCollisionExperiment('1', null)).toBeUndefined()
  })

  it('两个变体只改变命名 Heightfield narrowphase mode', () => {
    const baseline = getPhysicsCollisionVariant('cannon-default')
    const candidate = getPhysicsCollisionVariant('projected-aabb-v1')

    expect(Object.keys(candidate).sort()).toEqual(Object.keys(baseline).sort())
    expect(candidate.version).toBe(baseline.version)
    expect(candidate.heightfieldNarrowphaseMode).toBe('projected-aabb-v1')
  })
})
