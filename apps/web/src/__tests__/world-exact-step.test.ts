// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { PHYSICS } from '@/config/physics'
import { createPhysicsWorld } from '@/physics/world'

describe('PhysicsWorld exact step', () => {
  it('每次只推进一个固定步，且不向 Cannon accumulator 留下整步债务', () => {
    const { world, stepExact, dispose } = createPhysicsWorld()
    const cannonStep = vi.spyOn(world, 'step')

    try {
      for (let index = 1; index <= 3; index++) {
        stepExact()

        expect(cannonStep.mock.calls[index - 1]).toEqual([PHYSICS.fixedTimeStep])
        expect(world.stepnumber).toBe(index)
        expect(world.time).toBeCloseTo(index * PHYSICS.fixedTimeStep, 12)
        expect(world.accumulator).toBe(0)
        expect(world.accumulator).toBeLessThan(PHYSICS.fixedTimeStep)
      }
    } finally {
      cannonStep.mockRestore()
      dispose()
    }
  })
})
