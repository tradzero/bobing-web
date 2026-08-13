import * as CANNON from 'cannon-es'
import { PHYSICS } from '@/config/physics'

export type SolverMode = 'gs' | 'split'

export interface PhysicsWorldOptions {
  solverMode?: SolverMode
  solverIterations?: number
  solverTolerance?: number
}

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
export function createPhysicsWorld(options?: PhysicsWorldOptions): PhysicsWorld {
  const solverMode = options?.solverMode ?? 'gs'
  const solverIterations = options?.solverIterations ?? PHYSICS.solverIterations
  const solverTolerance = options?.solverTolerance ?? PHYSICS.solverTolerance
  const world = new CANNON.World()
  world.gravity.set(0, PHYSICS.gravity, 0)
  world.broadphase = new CANNON.SAPBroadphase(world)
  world.allowSleep = true

  const gsSolver = new CANNON.GSSolver()
  gsSolver.iterations = solverIterations
  gsSolver.tolerance = solverTolerance
  world.solver = solverMode === 'split' ? new CANNON.SplitSolver(gsSolver) : gsSolver

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
