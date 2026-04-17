import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { PHYSICS } from '@/config/physics'
import { createDiceBody } from './dice-body'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

// 从 dice-body.ts 重新导出，保持现有外部导入路径兼容
export { FACE_NORMALS } from './dice-body'

/** 骰子 mesh 与 body 的配对 */
export interface DicePair {
  mesh: THREE.Mesh
  body: CANNON.Body
}

/** 骰子数量 */
export const DICE_COUNT = 6

/** 纹理来源策略接口（支持后续替换为静态贴图加载） */
export interface DiceTextureSource {
  /** 返回 6 个面的纹理，索引 0~5 对应点数 1~6 */
  createTextures(): THREE.CanvasTexture[] | THREE.Texture[]
}

/**
 * 默认纹理来源：Canvas 2D 绘制
 * 四点面为红色，其余面为黑色
 */
export const canvasTextureSource: DiceTextureSource = {
  createTextures: createDiceTextures,
}

/** 当前使用的纹理来源（可通过 setTextureSource 替换） */
let activeTextureSource: DiceTextureSource = canvasTextureSource

/** 替换纹理来源（用于后续静态贴图加载） */
export function setTextureSource(source: DiceTextureSource): void {
  activeTextureSource = source
}

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
 * 创建单颗骰子 mesh + body
 */
export function createDice(): DicePair {
  const hs = PHYSICS.diceHalfSize

  // 从纹理来源获取 6 面纹理
  const textures = activeTextureSource.createTextures()
  const materials = FACE_MAP.materialOrder.map(
    (faceValue) =>
      new THREE.MeshStandardMaterial({
        map: textures[faceValue - 1],
        roughness: 0.6,
        metalness: 0.05,
      }),
  )

  // 视觉网格与当前物理模式保持一致：默认 box，实验时再启用圆角近似
  const chamferRadius = hs * PHYSICS.diceChamferRatio
  const geometry = chamferRadius > 0
    ? new RoundedBoxGeometry(hs * 2, hs * 2, hs * 2, 2, chamferRadius)
    : new THREE.BoxGeometry(hs * 2, hs * 2, hs * 2)
  const mesh = new THREE.Mesh(geometry, materials)
  mesh.castShadow = true
  mesh.receiveShadow = false

  // 物理 body：委托给 physics-only 工厂
  const body = createDiceBody()

  return { mesh, body }
}

/**
 * 批量创建 6 颗骰子
 */
export function createDiceSet(): DicePair[] {
  return Array.from({ length: DICE_COUNT }, () => createDice())
}
