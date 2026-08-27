// @vitest-environment node
import * as CANNON from 'cannon-es'
import { afterEach, describe, expect, it } from 'vitest'
import { createDiceBody } from '@/dice/dice-body'
import {
  HeightfieldProjectedAabbNarrowphase,
  PROJECTED_AABB_NARROWPHASE_UPSTREAM_VERSION,
} from '@/physics/heightfield-projected-aabb-narrowphase'
import { runRoll } from '@/physics/roll-runner'
import { createPhysicsWorld, type HeightfieldNarrowphaseMode } from '@/physics/world'
import { resetRandom } from '@/utils/random'

const ELEMENT_SIZE = 0.08
const GRID_SIZE = 17
const EXTENT = ELEMENT_SIZE * (GRID_SIZE - 1)

interface DifferentialScenario {
  localPosition: CANNON.Vec3
  localQuaternion: CANNON.Quaternion
  localVelocity: CANNON.Vec3
  localAngularVelocity: CANNON.Vec3
}

interface DifferentialFixture {
  physics: ReturnType<typeof createPhysicsWorld>
  heightfield: CANNON.Heightfield
  heightfieldBody: CANNON.Body
  die: CANNON.Body
  pillarCalls: () => number
}

function createHeightData(): number[][] {
  return Array.from({ length: GRID_SIZE }, (_, x) =>
    Array.from({ length: GRID_SIZE }, (_, y) => {
      const dx = x - (GRID_SIZE - 1) / 2
      const dy = y - (GRID_SIZE - 1) / 2
      return (dx * dx + dy * dy) * 0.00045 + Math.sin((x + y) * 0.7) * 0.002
    }),
  )
}

function createFixture(
  mode: HeightfieldNarrowphaseMode,
  scenario: DifferentialScenario,
): DifferentialFixture {
  const physics = createPhysicsWorld({ heightfieldNarrowphaseMode: mode })
  physics.world.gravity.set(0, 0, -9.82)

  const heightfield = new CANNON.Heightfield(createHeightData(), {
    elementSize: ELEMENT_SIZE,
  })
  let pillarCallCount = 0
  const originalGetPillar = heightfield.getConvexTrianglePillar.bind(heightfield)
  heightfield.getConvexTrianglePillar = (...args) => {
    pillarCallCount++
    return originalGetPillar(...args)
  }

  const heightfieldBody = new CANNON.Body({ mass: 0 })
  heightfieldBody.addShape(heightfield)
  heightfieldBody.position.set(-0.31, 0.27, -0.19)
  heightfieldBody.quaternion.setFromEuler(0.19, -0.23, 0.17)
  physics.world.addBody(heightfieldBody)

  const die = createDiceBody()
  CANNON.Transform.pointToWorldFrame(
    heightfieldBody.position,
    heightfieldBody.quaternion,
    scenario.localPosition,
    die.position,
  )
  heightfieldBody.quaternion.mult(scenario.localQuaternion, die.quaternion)
  heightfieldBody.quaternion.vmult(scenario.localVelocity, die.velocity)
  heightfieldBody.quaternion.vmult(scenario.localAngularVelocity, die.angularVelocity)
  physics.world.addBody(die)

  return {
    physics,
    heightfield,
    heightfieldBody,
    die,
    pillarCalls: () => pillarCallCount,
  }
}

function vector(value: CANNON.Vec3): [number, number, number] {
  return [value.x, value.y, value.z]
}

function bodySnapshot(body: CANNON.Body): Record<string, unknown> {
  return {
    position: vector(body.position),
    quaternion: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
    velocity: vector(body.velocity),
    angularVelocity: vector(body.angularVelocity),
    sleepState: body.sleepState,
  }
}

function bodyRole(
  body: CANNON.Body,
  die: CANNON.Body,
  heightfieldBody: CANNON.Body,
): 'die' | 'heightfield' {
  if (body === die) return 'die'
  if (body === heightfieldBody) return 'heightfield'
  throw new Error('differential 出现未注册 body')
}

function contactSnapshot(
  contact: CANNON.ContactEquation,
  die: CANNON.Body,
  heightfieldBody: CANNON.Body,
): Record<string, unknown> {
  return {
    bi: bodyRole(contact.bi, die, heightfieldBody),
    bj: bodyRole(contact.bj, die, heightfieldBody),
    si: contact.si.type,
    sj: contact.sj.type,
    ri: vector(contact.ri),
    rj: vector(contact.rj),
    ni: vector(contact.ni),
    restitution: contact.restitution,
    minForce: contact.minForce,
    maxForce: contact.maxForce,
    a: contact.a,
    b: contact.b,
    eps: contact.eps,
    enabled: contact.enabled,
  }
}

function frictionSnapshot(
  friction: CANNON.FrictionEquation,
  die: CANNON.Body,
  heightfieldBody: CANNON.Body,
): Record<string, unknown> {
  return {
    bi: bodyRole(friction.bi, die, heightfieldBody),
    bj: bodyRole(friction.bj, die, heightfieldBody),
    // cannon-es 的 friction equation 不保证回填 shape；显式保留该差异状态。
    si: friction.si?.type ?? null,
    sj: friction.sj?.type ?? null,
    ri: vector(friction.ri),
    rj: vector(friction.rj),
    t: vector(friction.t),
    minForce: friction.minForce,
    maxForce: friction.maxForce,
    a: friction.a,
    b: friction.b,
    eps: friction.eps,
    enabled: friction.enabled,
  }
}

function stepFixture(fixture: DifferentialFixture): Record<string, unknown> {
  fixture.physics.stepExact()
  return {
    body: bodySnapshot(fixture.die),
    contacts: fixture.physics.world.contacts.map((contact) =>
      contactSnapshot(contact, fixture.die, fixture.heightfieldBody),
    ),
    friction: fixture.physics.world.frictionEquations.map((friction) =>
      frictionSnapshot(friction, fixture.die, fixture.heightfieldBody),
    ),
    worldTime: fixture.physics.world.time,
    stepnumber: fixture.physics.world.stepnumber,
  }
}

function deterministicRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

function createScenarios(count: number): DifferentialScenario[] {
  const random = deterministicRandom(0x5eedc0de)
  const boundaries = [
    -ELEMENT_SIZE,
    0,
    ELEMENT_SIZE,
    EXTENT / 2,
    EXTENT - ELEMENT_SIZE,
    EXTENT,
    EXTENT + ELEMENT_SIZE,
  ]

  return Array.from({ length: count }, (_, index) => {
    const x = index % 3 === 0 ? boundaries[index % boundaries.length] : random() * EXTENT
    const y = index % 5 === 0 ? boundaries[(index * 3) % boundaries.length] : random() * EXTENT
    const z = -0.08 + random() * 0.48
    const localQuaternion = new CANNON.Quaternion()
    localQuaternion.setFromEuler(
      (random() - 0.5) * Math.PI * 2,
      (random() - 0.5) * Math.PI * 2,
      (random() - 0.5) * Math.PI * 2,
    )
    return {
      localPosition: new CANNON.Vec3(x, y, z),
      localQuaternion,
      localVelocity: new CANNON.Vec3(
        (random() - 0.5) * 0.6,
        (random() - 0.5) * 0.6,
        (random() - 0.5) * 0.6,
      ),
      localAngularVelocity: new CANNON.Vec3(
        (random() - 0.5) * 8,
        (random() - 0.5) * 8,
        (random() - 0.5) * 8,
      ),
    }
  })
}

function runJustTest(fixture: DifferentialFixture): boolean {
  const shape = fixture.die.shapes[0]
  if (!(shape instanceof CANNON.Box)) throw new Error('justTest fixture 必须使用 Box')
  shape.convexPolyhedronRepresentation.material = shape.material
  shape.convexPolyhedronRepresentation.collisionResponse = shape.collisionResponse
  const result = fixture.physics.world.narrowphase.convexHeightfield(
    shape.convexPolyhedronRepresentation,
    fixture.heightfield,
    fixture.die.position,
    fixture.heightfieldBody.position,
    fixture.die.quaternion,
    fixture.heightfieldBody.quaternion,
    fixture.die,
    fixture.heightfieldBody,
    shape,
    fixture.heightfield,
    true,
  )
  expect(fixture.physics.world.narrowphase.result).toHaveLength(0)
  expect(fixture.physics.world.narrowphase.frictionResult).toHaveLength(0)
  return result === true
}

describe('HeightfieldProjectedAabbNarrowphase', () => {
  afterEach(resetRandom)

  it('固定审查 cannon-es 0.20.0，且只有命名候选替换 narrowphase', () => {
    const baseline = createPhysicsWorld()
    const candidate = createPhysicsWorld({ heightfieldNarrowphaseMode: 'projected-aabb-v1' })
    try {
      expect(PROJECTED_AABB_NARROWPHASE_UPSTREAM_VERSION).toBe('0.20.0')
      expect(baseline.world.narrowphase).toBeInstanceOf(CANNON.Narrowphase)
      expect(baseline.world.narrowphase).not.toBeInstanceOf(HeightfieldProjectedAabbNarrowphase)
      expect(candidate.world.narrowphase).toBeInstanceOf(HeightfieldProjectedAabbNarrowphase)
    } finally {
      baseline.dispose()
      candidate.dispose()
    }
  })

  it('真实接触时减少 Pillar 候选，同时保持逐项 contact、friction 与 step 结果', () => {
    const scenario: DifferentialScenario = {
      localPosition: new CANNON.Vec3(EXTENT / 2, EXTENT / 2, 0.13),
      localQuaternion: new CANNON.Quaternion().setFromEuler(0.37, -0.29, 0.41),
      localVelocity: new CANNON.Vec3(0.1, -0.05, -0.2),
      localAngularVelocity: new CANNON.Vec3(1.2, -0.8, 0.4),
    }
    const baseline = createFixture('cannon-default', scenario)
    const candidate = createFixture('projected-aabb-v1', scenario)
    try {
      const baselineStep = stepFixture(baseline)
      const candidateStep = stepFixture(candidate)
      expect(candidateStep).toStrictEqual(baselineStep)
      expect((candidateStep.contacts as unknown[]).length).toBeGreaterThan(0)
      expect(candidate.pillarCalls()).toBeLessThan(baseline.pillarCalls())
    } finally {
      baseline.physics.dispose()
      candidate.physics.dispose()
    }
  })

  it('随机姿态、位置和 cell/terrain 边界的 step differential 严格等价', () => {
    for (const [index, scenario] of createScenarios(160).entries()) {
      const baseline = createFixture('cannon-default', scenario)
      const candidate = createFixture('projected-aabb-v1', scenario)
      try {
        const baselineStep = stepFixture(baseline)
        const candidateStep = stepFixture(candidate)
        expect(candidateStep, `scenario ${index}`).toStrictEqual(baselineStep)
      } finally {
        baseline.physics.dispose()
        candidate.physics.dispose()
      }
    }
  })

  it('随机姿态、位置和边界的 justTest 命中结果严格等价', () => {
    for (const [index, scenario] of createScenarios(200).entries()) {
      const baseline = createFixture('cannon-default', scenario)
      const candidate = createFixture('projected-aabb-v1', scenario)
      try {
        const baselineResult = runJustTest(baseline)
        const candidateResult = runJustTest(candidate)
        expect(candidateResult, `scenario ${index}`).toBe(baselineResult)
      } finally {
        baseline.physics.dispose()
        candidate.physics.dispose()
      }
    }
  })

  it(
    '200 seeds 的完整 RollRunResult 与 canonical 终态严格等价（含 watch 25042）',
    { timeout: 120_000 },
    () => {
      const seeds = [25_042, ...Array.from({ length: 199 }, (_, index) => 50_000 + index * 1_003)]
      for (const seed of seeds) {
        const baseline = runRoll({ seed, heightfieldNarrowphaseMode: 'cannon-default' })
        const candidate = runRoll({ seed, heightfieldNarrowphaseMode: 'projected-aabb-v1' })
        expect(candidate, `seed ${seed}`).toStrictEqual(baseline)
        expect(candidate.finalState, `seed ${seed} canonical final state`).toStrictEqual(
          baseline.finalState,
        )
      }
    },
  )
})
