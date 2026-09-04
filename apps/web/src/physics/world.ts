import { HeightfieldProjectedAabbNarrowphase } from './heightfield-projected-aabb-narrowphase'
import {
  createPhysicsWorld as createRuntimePhysicsWorld,
  type PhysicsWorld,
  type PhysicsWorldOptions as RuntimePhysicsWorldOptions,
} from './world-runtime'

export type HeightfieldNarrowphaseMode = 'cannon-default' | 'projected-aabb-v1'
export type { PhysicsWorld, SolverMode } from './world-runtime'

export interface PhysicsWorldOptions extends RuntimePhysicsWorldOptions {
  /** 命名实验开关；生产默认仍使用 cannon-default。 */
  heightfieldNarrowphaseMode?: HeightfieldNarrowphaseMode
}

/** 实验入口：只在显式候选模式替换 narrowphase，其余配置复用生产实现。 */
export function createPhysicsWorld(options?: PhysicsWorldOptions): PhysicsWorld {
  const heightfieldNarrowphaseMode = options?.heightfieldNarrowphaseMode ?? 'cannon-default'
  const physics = createRuntimePhysicsWorld(options)
  if (heightfieldNarrowphaseMode === 'projected-aabb-v1') {
    physics.world.narrowphase = new HeightfieldProjectedAabbNarrowphase(physics.world)
  }
  return physics
}
