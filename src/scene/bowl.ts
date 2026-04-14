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
 * 生成视觉碗内壁最终轮廓点（与 createBowl 塞进 LatheGeometry 的一致）
 * 返回纯数据 {r, y}[]，从碗口到碗底，供 T7 静态对齐测试校验
 */
export function generateInnerWallPoints(): { r: number; y: number }[] {
  const profile = sampleBowlInnerProfile(SEGMENTS)
  // 与 createBowl 内壁生成逻辑完全一致：从碗口到碗底逆序
  const points: { r: number; y: number }[] = []
  for (let i = profile.length - 1; i >= 0; i--) {
    points.push({ r: profile[i].r, y: profile[i].y })
  }
  return points
}

/**
 * 创建海碗可视模型
 * 使用 LatheGeometry 旋转体生成碗形，白瓷材质
 * 内壁基于共享 bowlInnerHeight 曲线，外壁 = 内壁半径方向偏移
 */
export function createBowl(): THREE.Mesh {
  const points: THREE.Vector2[] = []
  const innerProfile = sampleBowlInnerProfile(SEGMENTS)

  // 外壁轮廓：从碗底弯曲到碗口（内壁半径 + 厚度偏移）
  for (const { r, y } of innerProfile) {
    const outerR = r + BOWL_THICKNESS
    points.push(new THREE.Vector2(outerR, y))
  }

  // 碗口翻边
  const topInner = innerProfile[innerProfile.length - 1]
  points.push(new THREE.Vector2(topInner.r + BOWL_THICKNESS * 0.5, BOWL_HEIGHT))

  // 内壁轮廓：从碗口回到碗底（与 generateInnerWallPoints 一致，无额外偏移）
  for (let i = innerProfile.length - 1; i >= 0; i--) {
    const { r, y } = innerProfile[i]
    points.push(new THREE.Vector2(r, y))
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
