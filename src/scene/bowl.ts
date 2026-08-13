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

function createBowlPatternTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 512

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // 先铺一层接近瓷白的底色，再在外壁对应的 UV 带绘制占位青花纹样。
  ctx.fillStyle = '#fbf8f2'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const stripeColor = '#2a5f93'
  const motifColor = '#255789'
  const softColor = 'rgba(46, 97, 148, 0.18)'

  ctx.strokeStyle = stripeColor
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(0, 54)
  ctx.lineTo(canvas.width, 54)
  ctx.moveTo(0, 76)
  ctx.lineTo(canvas.width, 76)
  ctx.moveTo(0, 116)
  ctx.lineTo(canvas.width, 116)
  ctx.moveTo(0, 134)
  ctx.lineTo(canvas.width, 134)
  ctx.stroke()

  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(0, 196)
  ctx.lineTo(canvas.width, 196)
  ctx.moveTo(0, 302)
  ctx.lineTo(canvas.width, 302)
  ctx.stroke()

  // 中段主纹样采用循环团花占位，保证左右拼接时 seam 不会突兀。
  for (let x = -192; x <= canvas.width + 192; x += 256) {
    ctx.strokeStyle = motifColor
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.arc(x, 248, 44, 0, Math.PI * 2)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(x - 26, 248)
    ctx.quadraticCurveTo(x, 216, x + 26, 248)
    ctx.quadraticCurveTo(x, 280, x - 26, 248)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(x, 204)
    ctx.quadraticCurveTo(x + 18, 228, x, 248)
    ctx.quadraticCurveTo(x - 18, 228, x, 204)
    ctx.moveTo(x, 292)
    ctx.quadraticCurveTo(x + 18, 268, x, 248)
    ctx.quadraticCurveTo(x - 18, 268, x, 292)
    ctx.stroke()

    ctx.fillStyle = softColor
    ctx.beginPath()
    ctx.arc(x, 248, 12, 0, Math.PI * 2)
    ctx.fill()
  }

  // 靠近碗口再叠一层连续卷草边饰，后续正式素材可直接替换这一段。
  ctx.strokeStyle = motifColor
  ctx.lineWidth = 4
  for (let x = -160; x <= canvas.width + 160; x += 160) {
    ctx.beginPath()
    ctx.moveTo(x, 156)
    ctx.quadraticCurveTo(x + 40, 138, x + 80, 156)
    ctx.quadraticCurveTo(x + 120, 174, x + 160, 156)
    ctx.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  return texture
}

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
  const bowlPattern = createBowlPatternTexture()

  // 128 圆周分段消除俯视棱线和摩尔纹，碗仅一个，性能可忽略
  const geometry = new THREE.LatheGeometry(points, 128)
  // 白瓷釉面：继续用单色占位，但把釉感和层次做得更明显，强化海碗存在感。
  const wallMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf7f3ee,
    map: bowlPattern ?? undefined,
    roughness: 0.12,
    metalness: 0.02,
    envMapIntensity: 1.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, wallMaterial)
  mesh.castShadow = true
  mesh.receiveShadow = true

  // 独立底盖：最小遮缝策略，从上方微量盖住 Lathe 末端边缘
  // 分段与碗体一致（128）避免内接多边形不吻合
  const lastPoint = points[points.length - 1]
  const CAP_R_EXPAND = 0.001 // 半径外扩，仅遮缝不暴露底盖
  const CAP_Y_LIFT = 0.0001 // 微量上浮，从上方盖住接缝避免透出桌面
  const capGeo = new THREE.CircleGeometry(lastPoint.x + CAP_R_EXPAND, 128)
  const capMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xfdf8f1,
    roughness: 0.08,
    metalness: 0.01,
    envMapIntensity: 1.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
  })
  const cap = new THREE.Mesh(capGeo, capMaterial)
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
