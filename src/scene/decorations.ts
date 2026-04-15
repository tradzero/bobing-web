import * as THREE from 'three'

/**
 * 创建月饼装饰模型
 * 圆柱体 + 顶面花纹（Canvas 绘制），仅视觉，不参与碰撞
 */
function createMooncake(): THREE.Group {
  const group = new THREE.Group()
  const radius = 0.18
  const height = 0.08

  // 月饼主体：圆柱
  const bodyGeo = new THREE.CylinderGeometry(radius, radius, height, 24)
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xc8943e,
    roughness: 0.7,
    metalness: 0.05,
  })
  const body = new THREE.Mesh(bodyGeo, bodyMat)
  body.castShadow = true
  group.add(body)

  // 顶面花纹：Canvas 纹理（测试环境下 getContext 可能为 null，退化为纯色）
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#c8943e'
    ctx.fillRect(0, 0, 128, 128)

    // 简约花纹：同心圆 + 十字分割
    ctx.strokeStyle = '#a07030'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(64, 64, 50, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(64, 64, 30, 0, Math.PI * 2)
    ctx.stroke()
    // 十字
    ctx.beginPath()
    ctx.moveTo(64, 14)
    ctx.lineTo(64, 114)
    ctx.moveTo(14, 64)
    ctx.lineTo(114, 64)
    ctx.stroke()
    // 中心小圆
    ctx.beginPath()
    ctx.arc(64, 64, 10, 0, Math.PI * 2)
    ctx.fillStyle = '#a07030'
    ctx.fill()
  }

  const topTex = new THREE.CanvasTexture(canvas)
  const topMat = new THREE.MeshStandardMaterial({
    map: topTex,
    roughness: 0.6,
    metalness: 0.05,
  })
  const topGeo = new THREE.CircleGeometry(radius - 0.005, 24)
  const top = new THREE.Mesh(topGeo, topMat)
  top.rotation.x = -Math.PI / 2
  top.position.y = height / 2 + 0.001
  group.add(top)

  return group
}

/**
 * 创建灯笼装饰模型
 * LatheGeometry 旋转体 + 流苏，仅视觉
 */
function createLantern(): THREE.Group {
  const group = new THREE.Group()

  // 灯笼主体：LatheGeometry 椭球形
  const points: THREE.Vector2[] = []
  const segments = 12
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const angle = t * Math.PI
    // 椭球轮廓：水平半径随高度变化
    const r = Math.sin(angle) * 0.12
    const y = (t - 0.5) * 0.28
    points.push(new THREE.Vector2(r, y))
  }
  const lanternGeo = new THREE.LatheGeometry(points, 16)
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xcc2222,
    roughness: 0.5,
    metalness: 0.05,
    emissive: 0x441111,
    emissiveIntensity: 0.3,
    side: THREE.DoubleSide,
  })
  const lanternBody = new THREE.Mesh(lanternGeo, lanternMat)
  group.add(lanternBody)

  // 顶部金环
  const ringGeo = new THREE.TorusGeometry(0.03, 0.008, 8, 16)
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xd4a017,
    roughness: 0.3,
    metalness: 0.6,
  })
  const topRing = new THREE.Mesh(ringGeo, goldMat)
  topRing.position.y = 0.14
  topRing.rotation.x = Math.PI / 2
  group.add(topRing)

  // 底部金帽
  const capGeo = new THREE.CylinderGeometry(0.025, 0.035, 0.02, 12)
  const bottomCap = new THREE.Mesh(capGeo, goldMat)
  bottomCap.position.y = -0.14
  group.add(bottomCap)

  // 底座：让灯笼能稳地站在桌面上
  const baseGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.03, 12)
  const baseMesh = new THREE.Mesh(baseGeo, goldMat)
  baseMesh.position.y = -0.16
  group.add(baseMesh)

  return group
}

/**
 * 创建并放置所有桌面装饰物
 * 返回装饰物根 group，便于统一添加到 scene
 */
export function createDecorations(): THREE.Group {
  const root = new THREE.Group()
  root.name = 'decorations'

  // 放置 3 个月饼
  const mooncakePositions = [
    { x: -1.8, z: 1.2, rot: 0 },
    { x: 2.0, z: -0.8, rot: Math.PI / 4 },
    { x: -0.5, z: -2.0, rot: -Math.PI / 6 },
  ]
  for (const pos of mooncakePositions) {
    const mc = createMooncake()
    mc.position.set(pos.x, 0.04, pos.z)
    mc.rotation.y = pos.rot
    root.add(mc)
  }

  // 放置 2 个灯笼（桌面摆件，放在桌面上，放大 1.8 倍）
  const lanternPositions = [
    { x: -2.8, z: -1.8 },
    { x: 2.8, z: 1.8 },
  ]
  for (const pos of lanternPositions) {
    const lantern = createLantern()
    lantern.scale.setScalar(1.8)
    // y = 灯笼主体半高0.14 * 1.8 ≈ 0.25，放在桌面上
    lantern.position.set(pos.x, 0.26, pos.z)
    root.add(lantern)
  }

  return root
}
