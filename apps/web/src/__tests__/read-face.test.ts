// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as CANNON from 'cannon-es'
import { readFace, readFaceDetailed } from '@/dice/read-face'

/**
 * 创建一个带有指定四元数的 body
 */
function bodyWithQuaternion(q: CANNON.Quaternion): CANNON.Body {
  const body = new CANNON.Body({ mass: 1 })
  body.quaternion.copy(q)
  return body
}

/**
 * 24 个立方体合法朝向
 * 每个朝向由 (朝上面法线, 朝前面法线) 确定旋转
 * 我们通过 setFromAxisAngle 构造这些旋转
 */
describe('点数读取 - 24 个合法朝向', () => {
  // 面值与本地法线映射（与 create.ts 中 FACE_NORMALS 一致）
  // +x→2, -x→5, +y→1, -y→6, +z→3, -z→4
  const faceAxes: { value: number; axis: CANNON.Vec3 }[] = [
    { value: 2, axis: new CANNON.Vec3(1, 0, 0) }, // +x
    { value: 5, axis: new CANNON.Vec3(-1, 0, 0) }, // -x
    { value: 1, axis: new CANNON.Vec3(0, 1, 0) }, // +y
    { value: 6, axis: new CANNON.Vec3(0, -1, 0) }, // -y
    { value: 3, axis: new CANNON.Vec3(0, 0, 1) }, // +z
    { value: 4, axis: new CANNON.Vec3(0, 0, -1) }, // -z
  ]

  // 对于每个朝上面，构造让该面法线指向世界 +y 的旋转
  for (const { value, axis } of faceAxes) {
    // 找到从 axis 旋转到 +y 的四元数
    it(`朝上面 = ${value} (本地法线 ${axis.x},${axis.y},${axis.z} → 世界 +y)`, () => {
      const q = new CANNON.Quaternion()

      if (axis.y === 1) {
        // 已经朝上，不需要旋转
        q.set(0, 0, 0, 1)
      } else if (axis.y === -1) {
        // 翻转 180°
        q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI)
      } else if (axis.x === 1) {
        // +x → +y：绕 z 轴旋转 90°
        q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI / 2)
      } else if (axis.x === -1) {
        // -x → +y：绕 z 轴旋转 -90°
        q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), -Math.PI / 2)
      } else if (axis.z === 1) {
        // +z → +y：绕 x 轴旋转 -90°
        q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
      } else if (axis.z === -1) {
        // -z → +y：绕 x 轴旋转 90°
        q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2)
      }

      const body = bodyWithQuaternion(q)
      expect(readFace(body)).toBe(value)
    })

    // 对于每个朝上面，再绕 Y 轴旋转 0°、90°、180°、270°（共 4 个朝向）
    for (let r = 1; r < 4; r++) {
      it(`朝上面 = ${value} 绕 Y 旋转 ${r * 90}°`, () => {
        const q = new CANNON.Quaternion()

        if (axis.y === 1) {
          q.set(0, 0, 0, 1)
        } else if (axis.y === -1) {
          q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI)
        } else if (axis.x === 1) {
          q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI / 2)
        } else if (axis.x === -1) {
          q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), -Math.PI / 2)
        } else if (axis.z === 1) {
          q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
        } else if (axis.z === -1) {
          q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2)
        }

        // 附加绕 Y 轴旋转
        const qY = new CANNON.Quaternion()
        qY.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), (r * Math.PI) / 2)
        const combined = qY.mult(q)

        const body = bodyWithQuaternion(combined)
        expect(readFace(body)).toBe(value)
      })
    }
  }
})

describe('点数读取 - 近边界扰动', () => {
  it('在合法朝向上加微小扰动仍能正确读面', () => {
    const perturbAngle = 0.1 // ~5.7° 的扰动

    // 测试每个面朝上 + 随机扰动
    const testCases: { value: number; q: CANNON.Quaternion }[] = [
      { value: 1, q: new CANNON.Quaternion(0, 0, 0, 1) },
      {
        value: 6,
        q: (() => {
          const q = new CANNON.Quaternion()
          q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI)
          return q
        })(),
      },
      {
        value: 2,
        q: (() => {
          const q = new CANNON.Quaternion()
          q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI / 2)
          return q
        })(),
      },
      {
        value: 5,
        q: (() => {
          const q = new CANNON.Quaternion()
          q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), -Math.PI / 2)
          return q
        })(),
      },
      {
        value: 3,
        q: (() => {
          const q = new CANNON.Quaternion()
          q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
          return q
        })(),
      },
      {
        value: 4,
        q: (() => {
          const q = new CANNON.Quaternion()
          q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2)
          return q
        })(),
      },
    ]

    // 多个扰动轴
    const perturbAxes = [
      new CANNON.Vec3(1, 0, 0),
      new CANNON.Vec3(0, 0, 1),
      new CANNON.Vec3(1, 0, 1).scale(1 / Math.sqrt(2)),
    ]

    for (const { value, q } of testCases) {
      for (const axis of perturbAxes) {
        const qPerturb = new CANNON.Quaternion()
        qPerturb.setFromAxisAngle(axis, perturbAngle)
        const combined = qPerturb.mult(q)

        const body = bodyWithQuaternion(combined)
        expect(readFace(body)).toBe(value)
      }
    }
  })
})

// ── readFaceDetailed 可信度测试 ──
describe('readFaceDetailed - 可信度', () => {
  it('正常朝向 confidence ≈ 1.0', () => {
    // 1 面朝上（默认姿态）
    const body = bodyWithQuaternion(new CANNON.Quaternion(0, 0, 0, 1))
    const result = readFaceDetailed(body)
    expect(result.value).toBe(1)
    expect(result.confidence).toBeCloseTo(1.0, 3)
  })

  it('翻转 180° 朝向 confidence ≈ 1.0', () => {
    const q = new CANNON.Quaternion()
    q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI)
    const body = bodyWithQuaternion(q)
    const result = readFaceDetailed(body)
    expect(result.value).toBe(6)
    expect(result.confidence).toBeCloseTo(1.0, 3)
  })

  it('30° 倾斜时 confidence ≈ cos(30°) 且 value 稳定', () => {
    // 将面 1（+y）绕 x 轴倾斜 30°，仍应读出 value=1
    const tilt = Math.PI / 6 // 30°
    const q = new CANNON.Quaternion()
    q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), tilt)
    const body = bodyWithQuaternion(q)
    const result = readFaceDetailed(body)
    expect(result.value).toBe(1)
    expect(result.confidence).toBeCloseTo(Math.cos(tilt), 2)
  })

  it('45° 倾斜时 confidence ≈ cos(45°)，不断言 value（边界姿态）', () => {
    // 45° 是两个面点积可能并列的边界，只断言 confidence
    const tilt = Math.PI / 4 // 45°
    const q = new CANNON.Quaternion()
    q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), tilt)
    const body = bodyWithQuaternion(q)
    const result = readFaceDetailed(body)
    expect(result.confidence).toBeCloseTo(Math.cos(tilt), 2)
  })

  it('50° 倾斜时 value 切换到相邻面', () => {
    // 绕 x 轴旋转 50°
    // 旋转矩阵 Rx(θ): +y面(0,1,0) → dot=cos(50°)≈0.643
    //                    -z面(0,0,-1) → dot=sin(50°)≈0.766（最大）
    // -z 面对应 value=4
    const tilt = (50 * Math.PI) / 180
    const q = new CANNON.Quaternion()
    q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), tilt)
    const body = bodyWithQuaternion(q)
    const result = readFaceDetailed(body)
    expect(result.value).toBe(4)
    expect(result.confidence).toBeCloseTo(Math.sin(tilt), 2) // sin(50°) ≈ 0.766
  })
})
