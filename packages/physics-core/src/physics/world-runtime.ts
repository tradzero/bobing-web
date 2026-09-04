import * as CANNON from 'cannon-es'
import { PHYSICS } from '../config/physics'

export type SolverMode = 'gs' | 'split'

export interface PhysicsWorldOptions {
  solverMode?: SolverMode
  solverIterations?: number
  solverTolerance?: number
}

export interface PhysicsWorld {
  world: CANNON.World
  /** 仅供版本化调度实验使用；生产调度调用 stepExact。 */
  step: (dt: number) => void
  stepExact: () => void
  dispose: () => void
}

/** 当前生产物理世界：Cannon 默认 narrowphase + exact 固定步入口。 */
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
  const stepExact = () => {
    world.step(PHYSICS.fixedTimeStep)
  }
  const dispose = () => {
    while (world.bodies.length > 0) world.removeBody(world.bodies[0])
  }

  return { world, step, stepExact, dispose }
}
