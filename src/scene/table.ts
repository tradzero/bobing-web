import * as THREE from 'three'

/**
 * 创建圆桌桌面 mesh（Group：桌面主体 + 深色侧壁下沿）
 * 加厚至 0.35m，侧壁用深色材质增加层次感
 */
export function createTable(): THREE.Group {
  const radius = 4
  const topHeight = 0.12      // 桌面板厚度
  const skirtHeight = 0.23    // 侧壁裙边厚度
  const totalHeight = topHeight + skirtHeight  // ≈0.35

  const group = new THREE.Group()

  // 桌面主体：浅木色
  const topGeo = new THREE.CylinderGeometry(radius, radius, topHeight, 64)
  const topMat = new THREE.MeshStandardMaterial({
    color: 0x8b5e3c,
    roughness: 0.8,
    metalness: 0.05,
  })
  const topMesh = new THREE.Mesh(topGeo, topMat)
  topMesh.position.y = -topHeight / 2
  topMesh.receiveShadow = true
  group.add(topMesh)

  // 侧壁裙边：深色木质，紧贴桌面下方，略微内收
  const skirtGeo = new THREE.CylinderGeometry(radius - 0.03, radius - 0.06, skirtHeight, 64)
  const skirtMat = new THREE.MeshStandardMaterial({
    color: 0x5c3a1e,
    roughness: 0.85,
    metalness: 0.03,
  })
  const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat)
  skirtMesh.position.y = -topHeight - skirtHeight / 2
  skirtMesh.receiveShadow = true
  group.add(skirtMesh)

  return group
}
