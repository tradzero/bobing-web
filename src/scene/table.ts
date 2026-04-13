import * as THREE from 'three'

/**
 * 创建圆桌桌面 mesh
 * 使用圆柱几何体 + 木纹色基础材质
 */
export function createTable(): THREE.Mesh {
  const radius = 4
  const height = 0.15
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 64)
  const material = new THREE.MeshStandardMaterial({
    color: 0x8b5e3c,
    roughness: 0.8,
    metalness: 0.05,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y = -height / 2
  mesh.receiveShadow = true
  return mesh
}
