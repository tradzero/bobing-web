// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as CANNON from 'cannon-es'
import { SETTLE } from '@/config/settle'
import {
  applyContactClusterSettleAssist,
  createContactClusterAssistState,
} from '@/dice/contact-cluster-assist'

function makeBody(speed = 0, angularSpeed = 0): CANNON.Body {
  const body = new CANNON.Body({ mass: 0.03, allowSleep: true })
  body.velocity.set(speed, 0, 0)
  body.angularVelocity.set(angularSpeed, 0, 0)
  return body
}

function makeWorldWithContacts(...pairs: Array<[CANNON.Body, CANNON.Body]>): CANNON.World {
  return {
    contacts: pairs.map(([bi, bj]) => ({ bi, bj })),
  } as CANNON.World
}

describe('contact-cluster settle assist', () => {
  it('低速接触簇持续足够时间后冻结该簇', () => {
    const bodyA = makeBody(SETTLE.contactClusterAssist.speedThreshold * 0.5, 0)
    const bodyB = makeBody(SETTLE.contactClusterAssist.speedThreshold * 0.4, 0)
    const world = makeWorldWithContacts([bodyA, bodyB])
    const state = createContactClusterAssistState()
    const startTime = 0

    const firstProbe = SETTLE.contactClusterAssist.activationDelay + 0.01
    const secondProbe = firstProbe + SETTLE.contactClusterAssist.persistenceDuration + 0.01

    expect(
      applyContactClusterSettleAssist(world, [bodyA, bodyB], firstProbe, state, startTime),
    ).toBe(false)
    expect(bodyA.sleepState).not.toBe(CANNON.Body.SLEEPING)
    expect(bodyB.sleepState).not.toBe(CANNON.Body.SLEEPING)

    expect(
      applyContactClusterSettleAssist(world, [bodyA, bodyB], secondProbe, state, startTime),
    ).toBe(true)
    expect(bodyA.sleepState).toBe(CANNON.Body.SLEEPING)
    expect(bodyB.sleepState).toBe(CANNON.Body.SLEEPING)
  })

  it('存在簇外活跃骰子时不应介入', () => {
    const bodyA = makeBody(SETTLE.contactClusterAssist.speedThreshold * 0.5, 0)
    const bodyB = makeBody(SETTLE.contactClusterAssist.speedThreshold * 0.4, 0)
    const bodyC = makeBody(SETTLE.contactClusterAssist.speedThreshold * 0.3, 0)
    const world = makeWorldWithContacts([bodyA, bodyB])
    const state = createContactClusterAssistState()
    const currentTime = SETTLE.contactClusterAssist.activationDelay + SETTLE.contactClusterAssist.persistenceDuration + 0.05

    expect(
      applyContactClusterSettleAssist(world, [bodyA, bodyB, bodyC], currentTime, state, 0),
    ).toBe(false)
    expect(bodyA.sleepState).not.toBe(CANNON.Body.SLEEPING)
    expect(bodyB.sleepState).not.toBe(CANNON.Body.SLEEPING)
    expect(bodyC.sleepState).not.toBe(CANNON.Body.SLEEPING)
  })

  it('未到 activationDelay 前不应介入', () => {
    const bodyA = makeBody(SETTLE.contactClusterAssist.speedThreshold * 0.5, 0)
    const bodyB = makeBody(SETTLE.contactClusterAssist.speedThreshold * 0.4, 0)
    const world = makeWorldWithContacts([bodyA, bodyB])
    const state = createContactClusterAssistState()
    const currentTime = SETTLE.contactClusterAssist.activationDelay - 0.01

    expect(
      applyContactClusterSettleAssist(world, [bodyA, bodyB], currentTime, state, 0),
    ).toBe(false)
    expect(bodyA.sleepState).not.toBe(CANNON.Body.SLEEPING)
    expect(bodyB.sleepState).not.toBe(CANNON.Body.SLEEPING)
  })
})