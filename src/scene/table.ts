import * as THREE from 'three'

function createWoodTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const baseGradient = ctx.createLinearGradient(0, 0, 512, 512)
  baseGradient.addColorStop(0, '#7b4a3a')
  baseGradient.addColorStop(0.52, '#63372b')
  baseGradient.addColorStop(1, '#48271f')
  ctx.fillStyle = baseGradient
  ctx.fillRect(0, 0, 512, 512)

  // 只保留少量极淡的年轮提示，避免俯视时形成抢眼的靶环。
  for (let i = 0; i < 5; i++) {
    const radius = 118 + i * 42
    ctx.beginPath()
    ctx.ellipse(
      256 + Math.sin(i * 0.9) * 5,
      256 + Math.cos(i * 0.7) * 7,
      radius,
      radius * 0.78,
      Math.PI / 9,
      0,
      Math.PI * 2,
    )
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(39, 19, 15, 0.055)' : 'rgba(230, 180, 137, 0.028)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // 细密长向木纹成为主层次；振幅和明暗略有变化，但不产生额外纹理或几何。
  for (let i = 0; i < 46; i++) {
    const y = 8 + i * 11 + ((i % 5) - 2) * 1.4
    const wave = Math.sin(i * 1.73) * 7
    ctx.beginPath()
    ctx.moveTo(-20, y)
    ctx.bezierCurveTo(132, y - 5 + wave, 352, y + 6 - wave, 532, y + wave * 0.35)
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(238, 194, 158, 0.035)' : 'rgba(37, 18, 15, 0.075)'
    ctx.lineWidth = i % 9 === 0 ? 1.35 : 0.75
    ctx.stroke()
  }

  const vignette = ctx.createRadialGradient(256, 230, 120, 256, 256, 300)
  vignette.addColorStop(0, 'rgba(255, 235, 215, 0.025)')
  vignette.addColorStop(1, 'rgba(28, 13, 11, 0.24)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, 512, 512)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * 创建圆桌桌面 mesh（Group：桌面主体 + 深色侧壁下沿）
 * 加厚至 0.35m，侧壁用深色材质增加层次感
 */
export function createTable(): THREE.Group {
  const radius = 4
  const topHeight = 0.12 // 桌面板厚度
  const skirtHeight = 0.23 // 侧壁裙边厚度
  const woodTexture = createWoodTexture()

  const group = new THREE.Group()

  // 桌面主体：偏暗红棕的木色，让瓷白海碗成为画面主焦点。
  const topGeo = new THREE.CylinderGeometry(radius, radius, topHeight, 64)
  const topMat = new THREE.MeshStandardMaterial({
    color: 0x8b5a47,
    ...(woodTexture ? { map: woodTexture } : {}),
    roughness: 0.82,
    metalness: 0.05,
  })
  const topMesh = new THREE.Mesh(topGeo, topMat)
  topMesh.position.y = -topHeight / 2
  topMesh.receiveShadow = true
  group.add(topMesh)

  // 桌面嵌饰：用两道程序化纹样圈出博饼区域，让桌面中心更像设计稿里的仪式感桌面。
  const centerInlayMat = new THREE.MeshStandardMaterial({
    color: 0x8f5a3d,
    transparent: true,
    opacity: 0.28,
    roughness: 0.72,
    metalness: 0.04,
  })
  const centerInlay = new THREE.Mesh(new THREE.RingGeometry(1.44, 1.62, 96), centerInlayMat)
  centerInlay.rotation.x = -Math.PI / 2
  centerInlay.position.y = 0.002
  centerInlay.receiveShadow = true
  group.add(centerInlay)

  const outerInlayMat = new THREE.MeshStandardMaterial({
    color: 0x42241d,
    transparent: true,
    opacity: 0.2,
    roughness: 0.78,
    metalness: 0.02,
  })
  const outerInlay = new THREE.Mesh(new THREE.RingGeometry(3.18, 3.34, 128), outerInlayMat)
  outerInlay.rotation.x = -Math.PI / 2
  outerInlay.position.y = 0.0015
  outerInlay.receiveShadow = true
  group.add(outerInlay)

  // 侧壁裙边：深色木质，紧贴桌面下方，略微内收
  const skirtGeo = new THREE.CylinderGeometry(radius - 0.03, radius - 0.06, skirtHeight, 64)
  const skirtMat = new THREE.MeshStandardMaterial({
    color: 0x3f241e,
    roughness: 0.85,
    metalness: 0.03,
  })
  const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat)
  skirtMesh.position.y = -topHeight - skirtHeight / 2
  skirtMesh.receiveShadow = true
  group.add(skirtMesh)

  const lipMat = new THREE.MeshStandardMaterial({
    color: 0x593326,
    roughness: 0.75,
    metalness: 0.04,
  })
  const lipMesh = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.1, 0.06, 14, 96), lipMat)
  lipMesh.rotation.x = Math.PI / 2
  lipMesh.position.y = -0.01
  lipMesh.receiveShadow = true
  group.add(lipMesh)

  return group
}
