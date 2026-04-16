/**
 * 截角立方体（truncated cube）凸包几何生成
 *
 * 通过截切标准立方体的 8 个顶点，生成截角凸多面体：
 * - 24 顶点（每个原始顶点沿 3 条棱各产生 1 个新顶点）
 * - 14 面（8 个三角形 + 6 个八边形）
 * - 36 条边
 * - 满足欧拉关系 V - E + F = 24 - 36 + 14 = 2
 *
 * chamfer = 0 时退化为标准 8 顶点 / 6 面立方体。
 */

/** 立方体 8 个顶点的符号组合 (sx, sy, sz) */
const CORNER_SIGNS: [number, number, number][] = [
  [+1, +1, +1], // 0
  [+1, +1, -1], // 1
  [+1, -1, +1], // 2
  [+1, -1, -1], // 3
  [-1, +1, +1], // 4
  [-1, +1, -1], // 5
  [-1, -1, +1], // 6
  [-1, -1, -1], // 7
]

export function createChamferedCubeHull(
  halfSize: number,
  chamfer: number,
): { vertices: number[][]; faces: number[][] } {
  if (chamfer <= 0) {
    return createStandardCube(halfSize)
  }

  const h = halfSize
  const t = Math.min(chamfer, h - 1e-9) // 确保 h - t > 0

  // === 24 个顶点 ===
  // 每个角 c 产生 3 个顶点（索引 3c, 3c+1, 3c+2）：
  //   3c+0: z 轴缩进 → (sx*h, sy*h, sz*(h-t))
  //   3c+1: y 轴缩进 → (sx*h, sy*(h-t), sz*h)
  //   3c+2: x 轴缩进 → (sx*(h-t), sy*h, sz*h)
  const vertices: number[][] = []
  for (const [sx, sy, sz] of CORNER_SIGNS) {
    vertices.push([sx * h, sy * h, sz * (h - t)])
    vertices.push([sx * h, sy * (h - t), sz * h])
    vertices.push([sx * (h - t), sy * h, sz * h])
  }

  const faces: number[][] = []

  // === 8 个三角形面（每个角一个）===
  // 法线朝外方向与角的符号一致
  // winding 规则：sx*sy*sz > 0 时取 [0,2,1]，否则 [0,1,2]
  for (let c = 0; c < 8; c++) {
    const [sx, sy, sz] = CORNER_SIGNS[c]
    const base = 3 * c
    if (sx * sy * sz > 0) {
      faces.push([base, base + 2, base + 1])
    } else {
      faces.push([base, base + 1, base + 2])
    }
  }

  // === 6 个八边形面（每个原始面一个）===
  // 每面取该轴正/负侧 4 个角各 2 个顶点，按逆时针排列（从外侧看）
  faces.push([0, 1, 7, 6, 9, 10, 4, 3])       // +x
  faces.push([12, 15, 16, 22, 21, 18, 19, 13]) // -x
  faces.push([3, 5, 17, 15, 12, 14, 2, 0])     // +y
  faces.push([6, 8, 20, 18, 21, 23, 11, 9])    // -y
  faces.push([1, 2, 14, 13, 19, 20, 8, 7])     // +z
  faces.push([4, 10, 11, 23, 22, 16, 17, 5])   // -z

  return { vertices, faces }
}

/** chamfer=0 退化：标准立方体 8v / 6f */
function createStandardCube(h: number): { vertices: number[][]; faces: number[][] } {
  // 顶点索引与 CORNER_SIGNS 一一对应
  const vertices = CORNER_SIGNS.map(([sx, sy, sz]) => [sx * h, sy * h, sz * h])

  // 逆时针 winding（从外侧看），法线朝外
  const faces = [
    [0, 2, 3, 1], // +x
    [4, 5, 7, 6], // -x
    [0, 1, 5, 4], // +y
    [2, 6, 7, 3], // -y
    [0, 4, 6, 2], // +z
    [1, 3, 7, 5], // -z
  ]

  return { vertices, faces }
}
