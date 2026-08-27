// @vitest-environment node
import * as CANNON from 'cannon-es'
import { describe, expect, it } from 'vitest'
import {
  createBoxFloorFrameSampler,
  createFloorRelaunchTracker,
  FLOOR_RELAUNCH_SUPPORT_CLEARANCE_TOLERANCE,
  type FloorRelaunchFrameSample,
} from '@/physics/floor-relaunch'
import { createBowlBodies } from '@/physics/bowl-body'
import { createDiceBody } from '@/dice/dice-body'
import { createPhysicsWorld } from '@/physics/world'
import { setupContactMaterials } from '@/physics/materials'
import { PHYSICS } from '@/config/physics'

const floor = (worldY = 0.12): FloorRelaunchFrameSample => ({
  floorContact: true,
  externalContact: false,
  floorClearance: 0,
  worldY,
})
const air = (
  worldY: number,
  floorClearance: number,
  externalContact = false,
): FloorRelaunchFrameSample => ({
  floorContact: false,
  externalContact,
  floorClearance,
  worldY,
})

function push(
  tracker: ReturnType<typeof createFloorRelaunchTracker>,
  sample: FloorRelaunchFrameSample,
  count = 1,
) {
  for (let index = 0; index < count; index++) tracker.sample([sample])
}

function establishSecondarySupport(
  tracker: ReturnType<typeof createFloorRelaunchTracker>,
  supportedWorldY = 0.12,
): void {
  push(tracker, floor(supportedWorldY), 2)
  push(tracker, air(0.13, 0.01), 2)
  push(tracker, floor(supportedWorldY), 6)
}

describe('floor relaunch tracker', () => {
  it('忽略正常首次反弹，但捕获稳定支撑后的 floor-only 有序二次发射', () => {
    const tracker = createFloorRelaunchTracker(1)
    establishSecondarySupport(tracker)
    push(tracker, air(0.121, 0.006))
    push(tracker, air(0.128, 0.012))
    push(tracker, floor())

    const result = tracker.finish()
    expect(result.secondaryEpisodeCount).toBe(1)
    expect(result.floorOnlySecondaryEpisodeCount).toBe(1)
    expect(result.relaunchEventCount).toBe(1)
    expect(result.initialContactObservedDiceCount).toBe(1)
    expect(result.armedDiceCount).toBe(1)
    expect(result.events[0]).toMatchObject({
      airborneSteps: 2,
      externalContactObserved: false,
      qualifiesAsRelaunch: true,
    })
  })

  it('首次接触形成稳定支撑后再离地会被视为二次发射', () => {
    const tracker = createFloorRelaunchTracker(1)
    push(tracker, floor(), 12)
    push(tracker, air(0.121, 0.006))
    push(tracker, air(0.13, 0.015))
    push(tracker, floor())

    const result = tracker.finish()
    expect(result.secondaryEpisodeCount).toBe(1)
    expect(result.relaunchEventCount).toBe(1)
  })

  it('骰间/墙面/桌面接触会排除 floor-only 归因', () => {
    const tracker = createFloorRelaunchTracker(1)
    establishSecondarySupport(tracker)
    push(tracker, air(0.121, 0.006))
    push(tracker, air(0.13, 0.015, true))
    push(tracker, floor())

    const result = tracker.finish()
    expect(result.secondaryEpisodeCount).toBe(1)
    expect(result.floorOnlySecondaryEpisodeCount).toBe(0)
    expect(result.relaunchEventCount).toBe(0)
  })

  it('达到双阈值后再发生外部接触不会抹掉已经发生的 floor relaunch', () => {
    const tracker = createFloorRelaunchTracker(1)
    establishSecondarySupport(tracker)
    push(tracker, air(0.121, 0.006))
    push(tracker, air(0.128, 0.012))
    push(tracker, air(0.13, 0.015, true))
    push(tracker, floor())

    const result = tracker.finish()
    expect(result.events[0].externalContactObserved).toBe(true)
    expect(result.events[0].preExternalPeakClearance).toBeCloseTo(0.012)
    expect(result.events[0].preExternalOrderedWorldYRise).toBeCloseTo(0.008)
    expect(result.events[0].qualifiesAsRelaunch).toBe(true)
    expect(result.relaunchEventCount).toBe(1)
  })

  it('max 先于 min 的大范围下降不算有序回升', () => {
    const tracker = createFloorRelaunchTracker(1)
    establishSecondarySupport(tracker, 0.21)
    push(tracker, air(0.2, 0.02))
    push(tracker, air(0.15, 0.01))
    push(tracker, air(0.153, 0.012))
    push(tracker, floor())

    const result = tracker.finish()
    expect(result.maxFloorOnlySecondaryClearance).toBeCloseTo(0.02)
    expect(result.maxFloorOnlySecondaryOrderedWorldYRise).toBeCloseTo(0.003)
    expect(result.relaunchEventCount).toBe(0)
  })

  it('最后支撑点到首个离地帧的上升计入 ordered rise', () => {
    const tracker = createFloorRelaunchTracker(1)
    establishSecondarySupport(tracker)
    push(tracker, air(0.13, 0.01))
    push(tracker, air(0.125, 0.006))
    push(tracker, floor())

    const result = tracker.finish()
    expect(result.maxFloorOnlySecondaryOrderedWorldYRise).toBeCloseTo(0.01)
    expect(result.relaunchEventCount).toBe(1)
  })

  it('单个离散失联步不构成二次离地 episode', () => {
    const tracker = createFloorRelaunchTracker(1)
    establishSecondarySupport(tracker)
    push(tracker, air(0.13, 0.02))
    push(tracker, floor())

    const result = tracker.finish()
    expect(result.secondaryEpisodeCount).toBe(1)
    expect(result.floorOnlySecondaryEpisodeCount).toBe(0)
    expect(result.relaunchEventCount).toBe(0)
  })

  it('clearance 或 ordered rise 恰好 5mm 时不越过严格事件阈值', () => {
    const clearanceBoundary = createFloorRelaunchTracker(1)
    establishSecondarySupport(clearanceBoundary)
    push(clearanceBoundary, air(0.126, 0.005), 2)
    push(clearanceBoundary, floor())
    expect(clearanceBoundary.finish().relaunchEventCount).toBe(0)

    const riseBoundary = createFloorRelaunchTracker(1)
    establishSecondarySupport(riseBoundary)
    push(riseBoundary, air(0.125, 0.006), 2)
    push(riseBoundary, floor())
    expect(riseBoundary.finish().relaunchEventCount).toBe(0)
  })

  it('sampler 用真实 Heightfield 坐标读取 Box 顶点 clearance', () => {
    const { world, dispose } = createPhysicsWorld()
    try {
      setupContactMaterials(world)
      const { bottom } = createBowlBodies(world)
      const body = createDiceBody()
      body.position.set(0, 0.12, 0)
      world.addBody(body)
      const sampler = createBoxFloorFrameSampler([body], bottom)

      expect(sampler.available).toBe(true)
      const [aboveFloor] = sampler.sample([])
      expect(aboveFloor.floorContact).toBe(false)
      expect(aboveFloor.externalContact).toBe(false)
      expect(Math.abs(aboveFloor.floorClearance)).toBeLessThan(0.001)

      body.position.y += 0.01
      expect(sampler.sample([])[0].floorClearance - aboveFloor.floorClearance).toBeCloseTo(0.01, 5)
    } finally {
      dispose()
    }
  })

  it('sampler 按实际 body identity 区分碗底与外部接触', () => {
    const world = new CANNON.World()
    const bottom = new CANNON.Body({ mass: 0 })
    bottom.addShape(
      new CANNON.Heightfield(
        [
          [0, 0],
          [0, 0],
        ],
        { elementSize: 1 },
      ),
    )
    const die = new CANNON.Body({ mass: 1 })
    die.addShape(new CANNON.Box(new CANNON.Vec3(0.1, 0.1, 0.1)))
    const otherDie = new CANNON.Body({ mass: 1 })
    otherDie.addShape(new CANNON.Box(new CANNON.Vec3(0.1, 0.1, 0.1)))
    world.addBody(bottom)
    world.addBody(die)
    world.addBody(otherDie)
    const sampler = createBoxFloorFrameSampler([die], bottom)

    const floorContact = new CANNON.ContactEquation(die, bottom)
    expect(sampler.sample([floorContact])[0]).toMatchObject({
      floorContact: true,
      externalContact: false,
    })

    const diceContact = new CANNON.ContactEquation(die, otherDie)
    expect(sampler.sample([floorContact, diceContact])[0]).toMatchObject({
      floorContact: true,
      externalContact: true,
    })
  })

  it('sampler 对非 Box 形状显式报告不可用，而不是静默通过', () => {
    const bottom = new CANNON.Body({ mass: 0 })
    bottom.addShape(
      new CANNON.Heightfield(
        [
          [0, 0],
          [0, 0],
        ],
        { elementSize: 1 },
      ),
    )
    const sphere = new CANNON.Body({ mass: 1 })
    sphere.addShape(new CANNON.Sphere(0.1))

    const sampler = createBoxFloorFrameSampler([sphere], bottom)
    expect(sampler.available).toBe(false)
    expect(sampler.unavailableReason).toContain('Box')
    expect(sampler.sample([])).toEqual([])

    const offsetBottom = new CANNON.Body({ mass: 0 })
    offsetBottom.addShape(
      new CANNON.Heightfield(
        [
          [0, 0],
          [0, 0],
        ],
        { elementSize: 1 },
      ),
      new CANNON.Vec3(0.1, 0, 0),
    )
    const box = new CANNON.Body({ mass: 1 })
    box.addShape(new CANNON.Box(new CANNON.Vec3(0.1, 0.1, 0.1)))
    const offsetSampler = createBoxFloorFrameSampler([box], offsetBottom)
    expect(offsetSampler.available).toBe(false)
    expect(offsetSampler.unavailableReason).toContain('Heightfield shape')
  })

  it('真实 world + sampler 能捕获稳定支撑后的可控二次抬升', () => {
    const { world, step, dispose } = createPhysicsWorld()
    try {
      setupContactMaterials(world)
      const { bottom } = createBowlBodies(world)
      const body = createDiceBody()
      body.position.set(0, 0.12, 0)
      world.addBody(body)
      const sampler = createBoxFloorFrameSampler([body], bottom)
      const tracker = createFloorRelaunchTracker(1)

      const advance = () => {
        step(PHYSICS.fixedTimeStep)
        const sample = sampler.sample(world.contacts)[0]
        tracker.sample([sample])
        return sample
      }
      const supported = (sample: FloorRelaunchFrameSample) =>
        sample.floorContact || sample.floorClearance <= FLOOR_RELAUNCH_SUPPORT_CLEARANCE_TOLERANCE
      const waitForContactStreak = (target: number, maxSteps: number) => {
        let streak = 0
        for (let index = 0; index < maxSteps; index++) {
          streak = advance().floorContact ? streak + 1 : 0
          if (streak >= target) return true
        }
        return false
      }
      const launchAndWaitForReturn = (upwardSpeed: number) => {
        body.wakeUp()
        body.velocity.set(0, upwardSpeed, 0)
        let sawAirborne = false
        for (let index = 0; index < 180; index++) {
          const sample = advance()
          if (!supported(sample)) sawAirborne = true
          if (sawAirborne && supported(sample)) return true
        }
        return false
      }

      expect(waitForContactStreak(2, 60)).toBe(true)
      expect(launchAndWaitForReturn(0.4)).toBe(true)
      for (let index = 0; index < 8; index++) expect(supported(advance())).toBe(true)
      expect(launchAndWaitForReturn(1)).toBe(true)

      const result = tracker.finish()
      expect(result.relaunchEventCount).toBe(1)
      expect(result.events.find(({ qualifiesAsRelaunch }) => qualifiesAsRelaunch)).toMatchObject({
        externalContactObserved: false,
        qualifiesAsRelaunch: true,
      })
    } finally {
      dispose()
    }
  })
})
