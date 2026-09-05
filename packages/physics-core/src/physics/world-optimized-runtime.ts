import { HeightfieldProjectedAabbNarrowphase } from './heightfield-projected-aabb-narrowphase'
import {
  createPhysicsWorld as createBaseWorld,
  type PhysicsWorld,
  type PhysicsWorldOptions,
} from './world-runtime'

export type { PhysicsWorld, PhysicsWorldOptions, SolverMode } from './world-runtime'

/** 服务端采用已验证的候选裁剪；浏览器继续使用上游窄相，实验入口复用同一裁剪实现。 */
export function createPhysicsWorld(options?: PhysicsWorldOptions): PhysicsWorld {
  const physics = createBaseWorld(options)
  physics.world.narrowphase = new HeightfieldProjectedAabbNarrowphase(physics.world)
  return physics
}
