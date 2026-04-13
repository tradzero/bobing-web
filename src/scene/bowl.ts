import * as THREE from 'three'

/**
 * 创建海碗可视模型
 * 使用 LatheGeometry 旋转体生成碗形，白瓷材质
 */
export function createBowl(): THREE.Mesh {
  // 碗截面轮廓点（从碗底中心到碗口边缘）
  const points: THREE.Vector2[] = []
  const segments = 20
  const bowlRadius = 1.2
  const bowlHeight = 0.7
  const bowlThickness = 0.06

  // 外壁轮廓：从碗底弯曲到碗口
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    // 半抛物线曲线
    const x = bowlRadius * Math.pow(t, 0.6)
    const y = bowlHeight * t
    points.push(new THREE.Vector2(x, y))
  }

  // 碗口翻边（微小厚度）
  points.push(new THREE.Vector2(bowlRadius - bowlThickness * 0.5, bowlHeight))

  // 内壁轮廓：从碗口回到碗底
  for (let i = segments; i >= 0; i--) {
    const t = i / segments
    const x = Math.max(0, bowlRadius * Math.pow(t, 0.6) - bowlThickness)
    const y = bowlHeight * t + bowlThickness * 0.3
    points.push(new THREE.Vector2(x, y))
  }

  const geometry = new THREE.LatheGeometry(points, 32)
  const material = new THREE.MeshStandardMaterial({
    color: 0xf5f0eb,
    roughness: 0.3,
    metalness: 0.05,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}
