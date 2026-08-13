// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as CANNON from 'cannon-es'
import { placeDiceAtRest, REST_RING_RADIUS } from '@/dice/rest'
import { createDiceBody } from '@/dice/dice-body'
import { bowlInnerHeight } from '@/config/bowl'
import { PHYSICS } from '@/config/physics'
import type { DicePair } from '@/dice/create'

function createPairs(count = 6): DicePair[] {
  return Array.from({ length: count }, () => ({
    body: createDiceBody(),
    mesh: {} as DicePair['mesh'],
  }))
}

function expectQuaternionEqual(actual: CANNON.Quaternion, expected: CANNON.Quaternion): void {
  expect(actual.x).toBe(expected.x)
  expect(actual.y).toBe(expected.y)
  expect(actual.z).toBe(expected.z)
  expect(actual.w).toBe(expected.w)
}

describe('placeDiceAtRest', () => {
  it('将六颗骰子放在碗面上方的确定性环形位置', () => {
    const pairs = createPairs()

    placeDiceAtRest(pairs)

    const expectedMinimumY = bowlInnerHeight(REST_RING_RADIUS) + PHYSICS.diceHalfSize
    for (const { body } of pairs) {
      expect(Math.hypot(body.position.x, body.position.z)).toBeCloseTo(REST_RING_RADIUS)
      expect(body.position.y).toBeGreaterThan(expectedMinimumY)
      expect(body.position.y - expectedMinimumY).toBeLessThan(0.01)
    }
  })

  it('清空运动状态并同步 raw/previous/interpolated pose 后休眠', () => {
    const pairs = createPairs()
    for (const { body } of pairs) {
      body.position.set(9, 8, 7)
      body.previousPosition.set(-1, -2, -3)
      body.interpolatedPosition.set(-4, -5, -6)
      body.quaternion.setFromEuler(0.4, 0.5, 0.6)
      body.previousQuaternion.setFromEuler(0.1, 0.2, 0.3)
      body.interpolatedQuaternion.setFromEuler(-0.1, -0.2, -0.3)
      body.velocity.set(1, 2, 3)
      body.angularVelocity.set(4, 5, 6)
      body.force.set(7, 8, 9)
      body.torque.set(10, 11, 12)
      body.wakeUp()
    }

    placeDiceAtRest(pairs)

    for (const { body } of pairs) {
      expect(body.previousPosition.almostEquals(body.position)).toBe(true)
      expect(body.interpolatedPosition.almostEquals(body.position)).toBe(true)
      expectQuaternionEqual(body.previousQuaternion, body.quaternion)
      expectQuaternionEqual(body.interpolatedQuaternion, body.quaternion)
      expect(body.velocity.almostEquals(CANNON.Vec3.ZERO)).toBe(true)
      expect(body.angularVelocity.almostEquals(CANNON.Vec3.ZERO)).toBe(true)
      expect(body.force.almostEquals(CANNON.Vec3.ZERO)).toBe(true)
      expect(body.torque.almostEquals(CANNON.Vec3.ZERO)).toBe(true)
      expect(body.sleepState).toBe(CANNON.Body.SLEEPING)
      expect(body.aabbNeedsUpdate).toBe(true)
    }
  })
})
