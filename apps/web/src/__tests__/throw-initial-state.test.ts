// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as CANNON from 'cannon-es'
import { captureCanonicalBodyState, cloneCanonicalBodyState } from '@/dice/canonical-body-state'
import { captureThrowInitialState, cloneThrowInitialState } from '@/dice/throw-initial-state'

function makeBody(offset: number): CANNON.Body {
  const body = new CANNON.Body({ mass: 1 })
  body.position.set(1.25 + offset, -0, -3.5 - offset)
  body.quaternion.set(0.1 + offset, 0.2, 0.3, 0.9)
  body.velocity.set(-1, 2.5 + offset, 3)
  body.angularVelocity.set(4, -5, 6.25 + offset)
  return body
}

function rawState(body: CANNON.Body): number[] {
  return [
    body.position.x,
    body.position.y,
    body.position.z,
    body.quaternion.x,
    body.quaternion.y,
    body.quaternion.z,
    body.quaternion.w,
    body.velocity.x,
    body.velocity.y,
    body.velocity.z,
    body.angularVelocity.x,
    body.angularVelocity.y,
    body.angularVelocity.z,
  ]
}

describe('throw initial state diagnostics', () => {
  it('按 canonical body 顺序生成版本化 Float64 位级稳定签名且不写 body', () => {
    const bodies = [makeBody(0), makeBody(0.5)]
    const before = bodies.map(rawState)

    const first = captureThrowInitialState(bodies)
    const second = captureThrowInitialState(bodies)

    expect(first).toEqual(second)
    expect(first).toEqual(captureCanonicalBodyState(bodies))
    expect(first).toMatchObject({
      version: 1,
      floatEncoding: 'ieee754-float64-be',
      hashAlgorithm: 'fnv1a64',
      // 算法、字段顺序或 Float64 编码若改变，必须显式升级 schema/version。
      hash: '89d87bf1c74a7115',
    })
    expect(first.bodies).toHaveLength(2)
    expect(bodies.map(rawState)).toEqual(before)
  })

  it('body 顺序或任一未截断动力学值变化都会改变签名，旧快照不随 body 漂移', () => {
    const firstBody = makeBody(0)
    const secondBody = makeBody(0.5)
    const original = captureThrowInitialState([firstBody, secondBody])

    expect(captureThrowInitialState([secondBody, firstBody]).hash).not.toBe(original.hash)
    secondBody.velocity.x += Number.EPSILON
    expect(captureThrowInitialState([firstBody, secondBody]).hash).not.toBe(original.hash)
    expect(original.bodies[1].velocity[0]).toBe(-1)
  })

  it('canonical 与旧 initial clone 都深复制 tuple，不与输入 snapshot 或 body 共享', () => {
    const body = makeBody(0)
    const canonical = captureCanonicalBodyState([body])
    const canonicalClone = cloneCanonicalBodyState(canonical)
    const initialClone = cloneThrowInitialState(canonical)
    const originalX = body.position.x

    Reflect.set(canonicalClone.bodies[0].position, 0, originalX + 1)
    Reflect.set(initialClone.bodies[0].velocity, 0, 99)

    expect(canonical.bodies[0].position[0]).toBe(originalX)
    expect(canonical.bodies[0].velocity[0]).toBe(-1)
    expect(body.position.x).toBe(originalX)
    expect(body.velocity.x).toBe(-1)
  })
})
