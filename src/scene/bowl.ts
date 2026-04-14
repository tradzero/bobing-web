import * as THREE from 'three'
import {
  BOWL_RADIUS,
  BOWL_HEIGHT,
  BOWL_THICKNESS,
  BOWL_INNER_RADIUS,
  sampleBowlInnerProfile,
} from '@/config/bowl'

/** 视觉碗内壁采样段数 */
const SEGMENTS = 20

/**
 * 生成碗截面完整轮廓点列（外壁 → 碗口翻边 → 内壁）
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

  // 碗口翻边
  const topInner = innerProfile[innerProfile.length - 1]
  points.push(new THREE.Vector2(topInner.r + BOWL_THICKNESS * 0.5, BOWL_HEIGHT))

  // 内壁轮廓：从碗口回到碗底
  for (let i = innerProfile.length - 1; i >= 0; i--) {
    const { r, y } = innerProfile[i]
    points.push(new THREE.Vector2(r, y))
  }

  return points
}

/**
 * 创建海碗可视模型
 * 使用 LatheGeometry 旋转体生成碗形，白瓷材质
 * 内壁基于共享 bowlInnerHeight 曲线，外壁 = 内壁半径方向偏移
 */
export function createBowl(): THREE.Mesh {
  const points = generateBowlProfile()

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
