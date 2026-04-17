import * as THREE from 'three'

function createWoodTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const baseGradient = ctx.createRadialGradient(256, 208, 48, 256, 256, 292)
  baseGradient.addColorStop(0, '#a57149')
  baseGradient.addColorStop(0.55, '#8b5a38')
  baseGradient.addColorStop(1, '#6d4327')
  ctx.fillStyle = baseGradient
  ctx.fillRect(0, 0, 512, 512)

  // 程序化同心木纹：先建立大的环向层次，让俯视桌面不再是纯色圆盘。
  for (let i = 0; i < 16; i++) {
    const radius = 86 + i * 16
    ctx.beginPath()
    ctx.ellipse(
      256 + Math.sin(i * 0.9) * 3,
      256 + Math.cos(i * 0.7) * 5,
      radius,
      radius * 0.82,
      Math.PI / 10,
      0,
      Math.PI * 2,
    )
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(69, 36, 19, 0.16)' : 'rgba(241, 205, 139, 0.06)'
    ctx.lineWidth = i % 3 === 0 ? 3 : 2
    ctx.stroke()
  }

  // 再叠加少量长向木纹，避免环纹过于机械。
  for (let i = 0; i < 22; i++) {
    const y = 44 + i * 20 + ((i % 3) - 1) * 6
    ctx.beginPath()
    ctx.moveTo(24, y)
    ctx.bezierCurveTo(156, y - 18, 356, y + 20, 488, y - 10)
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(255, 234, 194, 0.045)' : 'rgba(68, 37, 21, 0.085)'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  const vignette = ctx.createRadialGradient(256, 256, 150, 256, 256, 256)
  vignette.addColorStop(0, 'rgba(255, 245, 220, 0)')
  vignette.addColorStop(1, 'rgba(32, 17, 11, 0.18)')
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
  const topHeight = 0.12      // 桌面板厚度
  const skirtHeight = 0.23    // 侧壁裙边厚度
  const woodTexture = createWoodTexture()

  const group = new THREE.Group()

  // 桌面主体：浅木色
  const topGeo = new THREE.CylinderGeometry(radius, radius, topHeight, 64)
  const topMat = new THREE.MeshStandardMaterial({
    color: 0x8b5e3c,
    map: woodTexture ?? undefined,
    roughness: 0.82,
    metalness: 0.05,
  })
  const topMesh = new THREE.Mesh(topGeo, topMat)
  topMesh.position.y = -topHeight / 2
  topMesh.receiveShadow = true
  group.add(topMesh)

  // 桌面嵌饰：用两道程序化纹样圈出博饼区域，让桌面中心更像设计稿里的仪式感桌面。
  const centerInlayMat = new THREE.MeshStandardMaterial({
    color: 0xa8733b,
    transparent: true,
    opacity: 0.6,
    roughness: 0.55,
    metalness: 0.08,
  })
  const centerInlay = new THREE.Mesh(new THREE.RingGeometry(1.44, 1.62, 96), centerInlayMat)
  centerInlay.rotation.x = -Math.PI / 2
  centerInlay.position.y = 0.002
  centerInlay.receiveShadow = true
  group.add(centerInlay)

  const outerInlayMat = new THREE.MeshStandardMaterial({
    color: 0x5c341d,
    transparent: true,
    opacity: 0.38,
    roughness: 0.7,
    metalness: 0.04,
  })
  const outerInlay = new THREE.Mesh(new THREE.RingGeometry(3.18, 3.34, 128), outerInlayMat)
  outerInlay.rotation.x = -Math.PI / 2
  outerInlay.position.y = 0.0015
  outerInlay.receiveShadow = true
  group.add(outerInlay)

  // 侧壁裙边：深色木质，紧贴桌面下方，略微内收
  const skirtGeo = new THREE.CylinderGeometry(radius - 0.03, radius - 0.06, skirtHeight, 64)
  const skirtMat = new THREE.MeshStandardMaterial({
    color: 0x4f2d18,
    roughness: 0.85,
    metalness: 0.03,
  })
  const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat)
  skirtMesh.position.y = -topHeight - skirtHeight / 2
  skirtMesh.receiveShadow = true
  group.add(skirtMesh)

  const lipMat = new THREE.MeshStandardMaterial({
    color: 0x6b4124,
    roughness: 0.62,
    metalness: 0.07,
  })
  const lipMesh = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.1, 0.06, 14, 96), lipMat)
  lipMesh.rotation.x = Math.PI / 2
  lipMesh.position.y = -0.01
  lipMesh.receiveShadow = true
  group.add(lipMesh)

  return group
}
