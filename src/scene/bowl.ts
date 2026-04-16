import * as THREE from 'three'
import {
  BOWL_HEIGHT,
  BOWL_THICKNESS,
  BOWL_INNER_RADIUS,
  sampleBowlInnerProfile,
} from '@/config/bowl'

/** 视觉碗内壁采样段数（48 段保证俯视近景曲线光滑） */
const SEGMENTS = 48

/** 碗口圆角翻边采样点数 */
const RIM_ARC_STEPS = 4

/**
 * 生成碗截面完整轮廓点列（外壁 → 碗口圆角翻边 → 内壁）
 * createBowl 直接消费此数组构建 LatheGeometry，T7 也引用同一函数校验
 * 单一来源，不可能分叉
 */
export function generateBowlProfile(): THREE.Vector2[] {
  const innerProfile = sampleBowlInnerProfile(SEGMENTS)
  const points: THREE.Vector2[] = []

  // 外壁轮廓：从碗底弯曲到碗口（内壁半径 + 厚度偏移）
  for (const { r, y } of innerProfile) {
    const outerR = r + BOWL_THICKNESS
    points.push(new THREE.Vector2(outerR, y))
  }

  // 碗口圆角翻边：用半圆弧连接外壁顶端与内壁顶端，消除尖角黑线
  // 圆弧圆心在外壁顶端和内壁顶端的中点，半径 = BOWL_THICKNESS / 2
  const outerTopR = BOWL_INNER_RADIUS + BOWL_THICKNESS
  const innerTopR = BOWL_INNER_RADIUS
  const rimCenterR = (outerTopR + innerTopR) / 2
  const rimRadius = BOWL_THICKNESS / 2
  for (let i = 0; i <= RIM_ARC_STEPS; i++) {
    // 从 0（外壁侧） 到 π（内壁侧）扫过半圆
    const angle = (i / RIM_ARC_STEPS) * Math.PI
    const r = rimCenterR + rimRadius * Math.cos(angle)
    const y = BOWL_HEIGHT + rimRadius * Math.sin(angle)
    points.push(new THREE.Vector2(r, y))
  }

  // 内壁轮廓：从碗口回到碗底，截止到 rFlat 避免近轴退化三角面
  // rFlat = BOWL_THICKNESS，此处物理曲线高度仅 0.017mm，视觉等于平面
  const rFlat = BOWL_THICKNESS
  for (let i = innerProfile.length - 1; i >= 0; i--) {
    const { r, y } = innerProfile[i]
    if (r < rFlat) continue // 跳过近轴点，由底盘覆盖
    points.push(new THREE.Vector2(r, y))
  }

  // 不再收敛到中心 (0,0)，避免 LatheGeometry 极点法线奇异
  // 碗底平面由独立 CircleGeometry 底盖覆盖

  return points
}

/**
 * 创建海碗可视模型
 * LatheGeometry 旋转体生成碗壁 + 独立 CircleGeometry 底盖
 * 避免 Lathe 极点法线奇异导致的星芒伪影
 */
export function createBowl(): THREE.Group {
  const points = generateBowlProfile()

  // 128 圆周分段消除俯视棱线和摩尔纹，碗仅一个，性能可忽略
  const geometry = new THREE.LatheGeometry(points, 128)
  // 白瓷釉面：MeshPhysicalMaterial + clearcoat 模拟瓷釉层
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xf8f4ef,
    roughness: 0.18,
    metalness: 0.02,
    envMapIntensity: 0.8,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = false
  mesh.receiveShadow = true

  // 独立底盖：最小遮缝策略，从上方微量盖住 Lathe 末端边缘
  // 分段与碗体一致（128）避免内接多边形不吻合
  const lastPoint = points[points.length - 1]
  const CAP_R_EXPAND = 0.001   // 半径外扩，仅遮缝不暴露底盖
  const CAP_Y_LIFT   = 0.0001  // 微量上浮，从上方盖住接缝避免透出桌面
  const capGeo = new THREE.CircleGeometry(lastPoint.x + CAP_R_EXPAND, 128)
  const cap = new THREE.Mesh(capGeo, material)
  // CircleGeometry 默认面朝 +Z，旋转到 XZ 平面使法线朝 +Y（碗内侧）
  cap.rotation.x = -Math.PI / 2
  cap.position.y = lastPoint.y + CAP_Y_LIFT
  cap.castShadow = false
  cap.receiveShadow = true

  const group = new THREE.Group()
  group.add(mesh)
  group.add(cap)
  return group
}
