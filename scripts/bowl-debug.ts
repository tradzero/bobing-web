import * as THREE from 'three'
import {
  BOWL_THICKNESS,
  BOWL_HEIGHT,
  BOWL_INNER_RADIUS,
  sampleBowlInnerProfile,
} from '../src/config/bowl.ts'

// 复制 generateBowlProfile 逻辑，避免 @/ alias 问题
function generateBowlProfile(): THREE.Vector2[] {
  const SEGMENTS = 48
  const RIM_ARC_STEPS = 4
  const innerProfile = sampleBowlInnerProfile(SEGMENTS)
  const points: THREE.Vector2[] = []
  for (const { r, y } of innerProfile) {
    points.push(new THREE.Vector2(r + BOWL_THICKNESS, y))
  }
  const rimCenterR = (BOWL_INNER_RADIUS + BOWL_THICKNESS + BOWL_INNER_RADIUS) / 2
  const rimRadius = BOWL_THICKNESS / 2
  for (let i = 0; i <= RIM_ARC_STEPS; i++) {
    const angle = (i / RIM_ARC_STEPS) * Math.PI
    const r = rimCenterR + rimRadius * Math.cos(angle)
    const y = BOWL_HEIGHT + rimRadius * Math.sin(angle)
    points.push(new THREE.Vector2(r, y))
  }
  const rFlat = BOWL_THICKNESS
  for (let i = innerProfile.length - 1; i >= 0; i--) {
    const { r, y } = innerProfile[i]
    if (r < rFlat) continue
    points.push(new THREE.Vector2(r, y))
  }
  // 不收敛到中心 (0,0)，碗底由独立 CircleGeometry 底盖覆盖
  return points
}

const points = generateBowlProfile()
console.log('=== 轮廓总点数:', points.length)

// 打印最后 10 个点（内壁底部 + 底盘）
console.log('\n=== 轮廓末尾 10 个点:')
for (let i = Math.max(0, points.length - 10); i < points.length; i++) {
  console.log(`  [${i}] r=${points[i].x.toFixed(6)} y=${points[i].y.toFixed(6)}`)
}

// 打印前 5 个点（外壁底部）
console.log('\n=== 轮廓开头 5 个点 (外壁底部):')
for (let i = 0; i < 5; i++) {
  console.log(`  [${i}] r=${points[i].x.toFixed(6)} y=${points[i].y.toFixed(6)}`)
}

// 检查是否有任何重复点
console.log('\n=== 检查重复坐标:')
let dupes = 0
for (let i = 0; i < points.length; i++) {
  for (let j = i + 1; j < points.length; j++) {
    if (Math.abs(points[i].x - points[j].x) < 1e-6 && Math.abs(points[i].y - points[j].y) < 1e-6) {
      console.log(
        `  重复: [${i}] 和 [${j}]: (${points[i].x.toFixed(6)}, ${points[i].y.toFixed(6)})`,
      )
      dupes++
    }
  }
}
if (dupes === 0) console.log('  无重复')

// 构造 LatheGeometry
const geo = new THREE.LatheGeometry(points, 128)
const pos = geo.getAttribute('position') as THREE.BufferAttribute
const idx = geo.index as THREE.BufferAttribute
const normal = geo.getAttribute('normal') as THREE.BufferAttribute

// 中心区域顶点
console.log('\n=== 中心区域顶点 (r < 0.01):')
let centerVerts = 0
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i),
    y = pos.getY(i),
    z = pos.getZ(i)
  const r = Math.sqrt(x * x + z * z)
  if (r < 0.01) {
    const nx = normal.getX(i),
      ny = normal.getY(i),
      nz = normal.getZ(i)
    if (centerVerts < 8)
      console.log(
        `  v[${i}] pos=(${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}) normal=(${nx.toFixed(3)},${ny.toFixed(3)},${nz.toFixed(3)})`,
      )
    centerVerts++
  }
}
console.log('  中心顶点总数:', centerVerts)

// 底盘三角面分析
console.log('\n=== 底盘区域三角面分析 (所有顶点 r < 0.1):')
let bottomFaces = 0
let nyPositive = 0,
  nyNegative = 0,
  nyZero = 0
for (let i = 0; i < idx.count; i += 3) {
  const i0 = idx.getX(i),
    i1 = idx.getX(i + 1),
    i2 = idx.getX(i + 2)
  const verts = [i0, i1, i2].map((vi) => ({
    x: pos.getX(vi),
    y: pos.getY(vi),
    z: pos.getZ(vi),
  }))
  const allBottom = verts.every((v) => Math.sqrt(v.x * v.x + v.z * v.z) < 0.1)
  if (!allBottom) continue
  bottomFaces++
  const e1 = { x: verts[1].x - verts[0].x, y: verts[1].y - verts[0].y, z: verts[1].z - verts[0].z }
  const e2 = { x: verts[2].x - verts[0].x, y: verts[2].y - verts[0].y, z: verts[2].z - verts[0].z }
  const fny = e1.z * e2.x - e1.x * e2.z
  if (fny > 1e-10) nyPositive++
  else if (fny < -1e-10) nyNegative++
  else nyZero++
}
console.log('  底盘面总数:', bottomFaces)
console.log('  法线朝上:', nyPositive, '朝下:', nyNegative, '退化:', nyZero)

// LatheGeometry seam 分析：检查 phi=0 和 phi=2π 处是否有重复顶点
console.log('\n=== LatheGeometry seam 分析:')
// LatheGeometry 在 phi=0 和 phi=2π 处各生成一列顶点 => 总列数 = segments+1 = 129
const segments = 128
const rows = points.length
const cols = segments + 1
console.log(`  rows(轮廓点)=${rows} cols(周向列)=${cols} 总顶点=${pos.count}`)

// 最后一个轮廓点(内壁最后保留点) 对应的一整行顶点
const lastRow = rows - 1
console.log(`\n=== 内壁最后保留点行 (row=${lastRow}) 前8列法线:`)
const lastRowNormals: { nx: number; ny: number; nz: number }[] = []
for (let col = 0; col < Math.min(cols, 8); col++) {
  const vi = lastRow * cols + col
  if (vi < pos.count) {
    const x = pos.getX(vi),
      z = pos.getZ(vi)
    const r = Math.sqrt(x * x + z * z)
    const nx = normal.getX(vi),
      ny = normal.getY(vi),
      nz = normal.getZ(vi)
    console.log(
      `  col=${col} r=${r.toFixed(4)} normal=(${nx.toFixed(3)},${ny.toFixed(3)},${nz.toFixed(3)})`,
    )
    lastRowNormals.push({ nx, ny, nz })
  }
}
// 法线散度
if (lastRowNormals.length > 1) {
  let maxAngle = 0
  for (let i = 1; i < lastRowNormals.length; i++) {
    const a = lastRowNormals[0],
      b = lastRowNormals[i]
    const dot = a.nx * b.nx + a.ny * b.ny + a.nz * b.nz
    const angle = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI
    if (angle > maxAngle) maxAngle = angle
  }
  console.log(`  最后保留点行法线最大散度: ${maxAngle.toFixed(1)}°`)
}

// 底盖信息
const lastPoint = points[points.length - 1]
const CAP_R_EXPAND = 0.001
const CAP_Y_LIFT = 0.0001
console.log(`\n=== 独立底盖参数:`)
console.log(`  内壁最后保留点: r=${lastPoint.x.toFixed(6)}, y=${lastPoint.y.toFixed(6)}`)
console.log(`  底盖半径: ${(lastPoint.x + CAP_R_EXPAND).toFixed(6)} (外扩 ${CAP_R_EXPAND})`)
console.log(`  底盖 y: ${(lastPoint.y + CAP_Y_LIFT).toFixed(6)} (上浮 ${CAP_Y_LIFT})`)
console.log(`  底盖分段: 128`)
