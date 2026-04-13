import * as CANNON from 'cannon-es'
import { PHYSICS } from '@/config/physics'

export interface PhysicsWorld {
  world: CANNON.World
  /** 固定时间步长推进 */
  step: (dt: number) => void
  dispose: () => void
}

/**
 * 创建 cannon-es 物理世界
 * 配置重力、broadphase、solver、allowSleep
 */
export function createPhysicsWorld(): PhysicsWorld {
  const world = new CANNON.World()
  world.gravity.set(0, PHYSICS.gravity, 0)
  world.broadphase = new CANNON.SAPBroadphase(world)
  world.allowSleep = true
  ;(world.solver as CANNON.GSSolver).iterations = 10

  const step = (dt: number) => {
    world.step(PHYSICS.fixedTimeStep, dt, PHYSICS.maxSubSteps)
  }

  const dispose = () => {
    // 移除所有 body
    while (world.bodies.length > 0) {
      world.removeBody(world.bodies[0])
    }
  }

  return { world, step, dispose }
}
