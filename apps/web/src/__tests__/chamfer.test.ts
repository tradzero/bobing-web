// @vitest-environment node
import { describe, it, expect } from 'vitest'
import * as CANNON from 'cannon-es'
import { createChamferedCubeHull } from '@/dice/chamfer'
import { PHYSICS } from '@/config/physics'

/**
 * 截角立方体凸包几何测试
 * 覆盖 CHECKLIST Step 1 的 1.4 ~ 1.8
 */
describe('createChamferedCubeHull', () => {
  const h = PHYSICS.diceHalfSize
  // 几何 helper 测试不绑定运行时默认配置，避免默认回退 box 时丢失 chamfer 覆盖。
  const chamfer = h * 0.15

  /** 计算面法线（前 3 顶点的叉积） */
  function faceNormal(vertices: number[][], face: number[]): number[] {
    const v0 = vertices[face[0]]
    const v1 = vertices[face[1]]
    const v2 = vertices[face[2]]
    const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]]
    const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]]
    return [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ]
  }

  /** 面心坐标 */
  function faceCenter(vertices: number[][], face: number[]): number[] {
    const c = [0, 0, 0]
    for (const vi of face) {
      c[0] += vertices[vi][0]
      c[1] += vertices[vi][1]
      c[2] += vertices[vi][2]
    }
    c[0] /= face.length
    c[1] /= face.length
    c[2] /= face.length
    return c
  }

  describe('截角立方体 (chamfer > 0)', () => {
    const { vertices, faces } = createChamferedCubeHull(h, chamfer)

    it('1.4: 顶点数 = 24，面数 = 14', () => {
      expect(vertices).toHaveLength(24)
      expect(faces).toHaveLength(14)
    })

    it('1.4b: 8 个三角形 + 6 个八边形', () => {
      const triangles = faces.filter((f) => f.length === 3)
      const octagons = faces.filter((f) => f.length === 8)
      expect(triangles).toHaveLength(8)
      expect(octagons).toHaveLength(6)
    })

    it('1.5: 所有面法线朝外（法线与质心→面心向量同向）', () => {
      for (let fi = 0; fi < faces.length; fi++) {
        const normal = faceNormal(vertices, faces[fi])
        const center = faceCenter(vertices, faces[fi])
        // 质心在原点，法线·面心 > 0 表示朝外
        const dot = normal[0] * center[0] + normal[1] * center[1] + normal[2] * center[2]
        expect(dot, `face ${fi} 法线应朝外`).toBeGreaterThan(0)
      }
    })

    it('1.6: 包围盒 ≤ 原 Box（每轴最大坐标 ≤ halfSize）', () => {
      for (const v of vertices) {
        expect(Math.abs(v[0])).toBeLessThanOrEqual(h + 1e-10)
        expect(Math.abs(v[1])).toBeLessThanOrEqual(h + 1e-10)
        expect(Math.abs(v[2])).toBeLessThanOrEqual(h + 1e-10)
      }
    })

    it('1.5b: 欧拉关系 V - E + F = 2', () => {
      // 从面列表收集边（无序对），计数唯一边
      const edgeSet = new Set<string>()
      for (const face of faces) {
        for (let i = 0; i < face.length; i++) {
          const a = face[i]
          const b = face[(i + 1) % face.length]
          const key = a < b ? `${a}-${b}` : `${b}-${a}`
          edgeSet.add(key)
        }
      }
      const V = vertices.length // 24
      const E = edgeSet.size // 36
      const F = faces.length // 14
      expect(V - E + F).toBe(2)
    })
  })

  describe('退化为标准立方体 (chamfer = 0)', () => {
    const { vertices, faces } = createChamferedCubeHull(h, 0)

    it('1.7: chamfer=0 → 8 顶点 / 6 面', () => {
      expect(vertices).toHaveLength(8)
      expect(faces).toHaveLength(6)
    })

    it('1.7b: chamfer=0 面法线也朝外', () => {
      for (let fi = 0; fi < faces.length; fi++) {
        const normal = faceNormal(vertices, faces[fi])
        const center = faceCenter(vertices, faces[fi])
        const dot = normal[0] * center[0] + normal[1] * center[1] + normal[2] * center[2]
        expect(dot, `face ${fi} 法线应朝外`).toBeGreaterThan(0)
      }
    })

    it('1.7c: chamfer=0 满足欧拉关系', () => {
      const edgeSet = new Set<string>()
      for (const face of faces) {
        for (let i = 0; i < face.length; i++) {
          const a = face[i]
          const b = face[(i + 1) % face.length]
          const key = a < b ? `${a}-${b}` : `${b}-${a}`
          edgeSet.add(key)
        }
      }
      expect(vertices.length - edgeSet.size + faces.length).toBe(2)
    })
  })

  it('1.8: CANNON.ConvexPolyhedron 能用截角数据成功构造', () => {
    const { vertices, faces } = createChamferedCubeHull(h, chamfer)
    const verts = vertices.map((v) => new CANNON.Vec3(v[0], v[1], v[2]))
    expect(() => new CANNON.ConvexPolyhedron({ vertices: verts, faces })).not.toThrow()
  })

  it('1.8b: chamfer=0 立方体也能构造 ConvexPolyhedron', () => {
    const { vertices, faces } = createChamferedCubeHull(h, 0)
    const verts = vertices.map((v) => new CANNON.Vec3(v[0], v[1], v[2]))
    expect(() => new CANNON.ConvexPolyhedron({ vertices: verts, faces })).not.toThrow()
  })
})
