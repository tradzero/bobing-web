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

  // 碗底平底盘：从内壁最后保留点直接扇形收敛到中心，不重复外壁起点半径
  points.push(new THREE.Vector2(0, 0))

  return points
}

/**
 * 创建海碗可视模型
 * 使用 LatheGeometry 旋转体生成碗形，白瓷材质
 * 内壁基于共享 bowlInnerHeight 曲线，外壁 = 内壁半径方向偏移
 */
export function createBowl(): THREE.Mesh {
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
  // 碗只接收阴影，不投射，避免凹面自遮挡条纹
  mesh.castShadow = false
  mesh.receiveShadow = true
  return mesh
}
