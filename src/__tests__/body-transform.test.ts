// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import * as CANNON from 'cannon-es'
import * as THREE from 'three'
import { copyBodyTransformToObject, syncBodyInterpolationState } from '@/physics/body-transform'
import { createDiceBody } from '@/dice/dice-body'
import { throwDice } from '@/dice/throw'
import { resetRandom, setRandom } from '@/utils/random'

function expectPosition(
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number },
): void {
  expect([actual.x, actual.y, actual.z]).toEqual([expected.x, expected.y, expected.z])
}

function expectQuaternion(
  actual: { x: number; y: number; z: number; w: number },
  expected: { x: number; y: number; z: number; w: number },
): void {
  expect([actual.x, actual.y, actual.z, actual.w]).toEqual([
    expected.x,
    expected.y,
    expected.z,
    expected.w,
  ])
}

describe('body transform 同步', () => {
  afterEach(() => {
    resetRandom()
  })

  it('同步 teleport 后的 previous 与 interpolated pose', () => {
    const body = new CANNON.Body({ mass: 1 })
    body.position.set(1, 2, 3)
    body.quaternion.set(0.1, 0.2, 0.3, 0.4)
    body.previousPosition.set(-1, -2, -3)
    body.interpolatedPosition.set(-4, -5, -6)
    body.previousQuaternion.set(-0.1, -0.2, -0.3, -0.4)
    body.interpolatedQuaternion.set(-0.4, -0.3, -0.2, -0.1)

    syncBodyInterpolationState(body)

    expectPosition(body.previousPosition, body.position)
    expectPosition(body.interpolatedPosition, body.position)
    expectQuaternion(body.previousQuaternion, body.quaternion)
    expectQuaternion(body.interpolatedQuaternion, body.quaternion)
  })

  it('raw 模式读取当前物理姿态', () => {
    const body = new CANNON.Body({ mass: 1 })
    const object = new THREE.Object3D()
    body.position.set(1, 2, 3)
    body.quaternion.set(0.1, 0.2, 0.3, 0.4)
    body.interpolatedPosition.set(11, 12, 13)
    body.interpolatedQuaternion.set(0.5, 0.6, 0.7, 0.8)

    copyBodyTransformToObject(body, object, 'raw')

    expectPosition(object.position, body.position)
    expectQuaternion(object.quaternion, body.quaternion)
  })

  it('interpolated 模式读取 Cannon 插值姿态', () => {
    const body = new CANNON.Body({ mass: 1 })
    const object = new THREE.Object3D()
    body.position.set(1, 2, 3)
    body.quaternion.set(0.1, 0.2, 0.3, 0.4)
    body.interpolatedPosition.set(11, 12, 13)
    body.interpolatedQuaternion.set(0.5, 0.6, 0.7, 0.8)

    copyBodyTransformToObject(body, object, 'interpolated')

    expectPosition(object.position, body.interpolatedPosition)
    expectQuaternion(object.quaternion, body.interpolatedQuaternion)
  })

  it('throwDice 完成后四个插值辅助状态均与最终 pose 一致', () => {
    // 固定为同一点的 rejection 候选会进入 fallback，覆盖最终高度二次改写路径。
    setRandom(() => 0)
    const pairs = Array.from({ length: 6 }, () => {
      const body = createDiceBody()
      body.previousPosition.set(-1, -1, -1)
      body.interpolatedPosition.set(-2, -2, -2)
      body.previousQuaternion.set(-1, 0, 0, 0)
      body.interpolatedQuaternion.set(0, -1, 0, 0)
      return { body, mesh: new THREE.Object3D() }
    })

    const diagnostics = throwDice(pairs)

    expect(diagnostics.placementPath).toBe('fallback')
    for (const { body } of pairs) {
      expectPosition(body.previousPosition, body.position)
      expectPosition(body.interpolatedPosition, body.position)
      expectQuaternion(body.previousQuaternion, body.quaternion)
      expectQuaternion(body.interpolatedQuaternion, body.quaternion)
    }
  })
})
