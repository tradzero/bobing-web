import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { PHYSICS } from '@/config/physics'
import { diceMaterial } from '@/physics/materials'

/** 骰子 mesh 与 body 的配对 */
export interface DicePair {
  mesh: THREE.Mesh
  body: CANNON.Body
}

/** 骰子数量 */
export const DICE_COUNT = 6

/**
 * 骰子面纹理生成器（Canvas 2D 绘制）
 * 返回 6 个面的 CanvasTexture，四点面为红色
 */
function createDiceTextures(): THREE.CanvasTexture[] {
  const size = 128
  const dotRadius = size * 0.08

  // 各面点数对应的点位布局（归一化坐标 0-1）
  const dotPositions: [number, number][][] = [
    // 1 点
    [[0.5, 0.5]],
    // 2 点
    [
      [0.28, 0.28],
      [0.72, 0.72],
    ],
    // 3 点
    [
      [0.28, 0.28],
      [0.5, 0.5],
      [0.72, 0.72],
    ],
    // 4 点
    [
      [0.28, 0.28],
      [0.72, 0.28],
      [0.28, 0.72],
      [0.72, 0.72],
    ],
    // 5 点
    [
      [0.28, 0.28],
      [0.72, 0.28],
      [0.5, 0.5],
      [0.28, 0.72],
      [0.72, 0.72],
    ],
    // 6 点
    [
      [0.28, 0.25],
      [0.72, 0.25],
      [0.28, 0.5],
      [0.72, 0.5],
      [0.28, 0.75],
      [0.72, 0.75],
    ],
  ]

  return dotPositions.map((dots, index) => {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!

    // 背景：骨质/象牙白
    ctx.fillStyle = '#f5f0e8'
    ctx.fillRect(0, 0, size, size)

    // 边框
    ctx.strokeStyle = '#d0c8b8'
    ctx.lineWidth = 2
    ctx.strokeRect(2, 2, size - 4, size - 4)

    // 点数颜色：四点面（index=3）使用红色，其余黑色
    ctx.fillStyle = index === 3 ? '#cc2222' : '#1a1a1a'

    for (const [x, y] of dots) {
      ctx.beginPath()
      ctx.arc(x * size, y * size, dotRadius, 0, Math.PI * 2)
      ctx.fill()
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  })
}

/**
 * 骰子面法线与点数的映射关系
 * BoxGeometry 的面顺序：+x, -x, +y, -y, +z, -z
 * 标准骰子对面之和为7：1对6，2对5，3对4
 */
const FACE_MAP = {
  // Three.js BoxGeometry material index → 点数
  // index 0: +x → 点数 2
  // index 1: -x → 点数 5
  // index 2: +y → 点数 1
  // index 3: -y → 点数 6
  // index 4: +z → 点数 3
  // index 5: -z → 点数 4
  materialOrder: [2, 5, 1, 6, 3, 4] as const,
}

/**
 * 面法线常量（本地坐标）
 * 与 FACE_MAP.materialOrder 一一对应
 */
export const FACE_NORMALS: { normal: CANNON.Vec3; value: number }[] = [
  { normal: new CANNON.Vec3(1, 0, 0), value: 2 }, // +x
  { normal: new CANNON.Vec3(-1, 0, 0), value: 5 }, // -x
  { normal: new CANNON.Vec3(0, 1, 0), value: 1 }, // +y
  { normal: new CANNON.Vec3(0, -1, 0), value: 6 }, // -y
  { normal: new CANNON.Vec3(0, 0, 1), value: 3 }, // +z
  { normal: new CANNON.Vec3(0, 0, -1), value: 4 }, // -z
]

/**
 * 创建单颗骰子 mesh + body
 */
export function createDice(): DicePair {
  const hs = PHYSICS.diceHalfSize

  // 从 FACE_MAP 生成 6 面材质
  const textures = createDiceTextures()
  const materials = FACE_MAP.materialOrder.map(
    (faceValue) =>
      new THREE.MeshStandardMaterial({
        map: textures[faceValue - 1],
        roughness: 0.6,
        metalness: 0.05,
      }),
  )

  const geometry = new THREE.BoxGeometry(hs * 2, hs * 2, hs * 2)
  const mesh = new THREE.Mesh(geometry, materials)
  mesh.castShadow = true
  mesh.receiveShadow = true

  // 物理 body
  const body = new CANNON.Body({
    mass: PHYSICS.diceMass,
    material: diceMaterial,
    linearDamping: PHYSICS.diceLinearDamping,
    angularDamping: PHYSICS.diceAngularDamping,
    allowSleep: true,
    sleepSpeedLimit: PHYSICS.diceSleepSpeedLimit,
    sleepTimeLimit: PHYSICS.diceSleepTimeLimit,
  })
  body.addShape(new CANNON.Box(new CANNON.Vec3(hs, hs, hs)))

  return { mesh, body }
}

/**
 * 批量创建 6 颗骰子
 */
export function createDiceSet(): DicePair[] {
  return Array.from({ length: DICE_COUNT }, () => createDice())
}
