import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { PHYSICS } from '@/config/physics'
import { createDiceBody } from './dice-body'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

// 从 dice-body.ts 重新导出，保持现有外部导入路径兼容
export { FACE_NORMALS } from './dice-body'

/** 骰子 mesh 与 body 的配对 */
export interface DicePair {
  mesh: THREE.Object3D
  body: CANNON.Body
}

/** 骰子数量 */
export const DICE_COUNT = 6

export interface DiceFaceTextureSet {
  map: THREE.Texture
  bumpMap?: THREE.Texture
  roughnessMap?: THREE.Texture
}

type DiceFaceTextureAsset = THREE.Texture | DiceFaceTextureSet

/** 纹理来源策略接口（支持后续替换为静态贴图加载） */
export interface DiceTextureSource {
  /** 返回 6 个面的纹理资源，索引 0~5 对应点数 1~6 */
  createTextures(): DiceFaceTextureAsset[]
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

/** 默认 Canvas 纹理可在 6 颗骰子间复用，避免重复创建同内容贴图 */
let cachedCanvasFaceTextures: DiceFaceTextureSet[] | null = null

/** 替换纹理来源（用于后续静态贴图加载） */
export function setTextureSource(source: DiceTextureSource): void {
  activeTextureSource = source
}

/** 各面点数对应的点位布局（归一化坐标 0-1） */
const DOT_POSITIONS: [number, number][][] = [
  [[0.5, 0.5]],
  [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  [
    [0.28, 0.28],
    [0.5, 0.5],
    [0.72, 0.72],
  ],
  [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.5, 0.5],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  [
    [0.28, 0.25],
    [0.72, 0.25],
    [0.28, 0.5],
    [0.72, 0.5],
    [0.28, 0.75],
    [0.72, 0.75],
  ],
]

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function createCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  return canvas
}

function createCanvasTexture(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

function normalizeFaceTextures(asset: DiceFaceTextureAsset): DiceFaceTextureSet {
  return asset instanceof THREE.Texture ? { map: asset } : asset
}

function pipColor(faceIndex: number): string {
  return faceIndex === 3 ? '#c63b2c' : '#171413'
}

/**
 * 颜色图：干净象牙白骰身 + 清晰硬边点数。
 * 这一版刻意拿掉整面下陷和脏污阴影，优先贴近参考图那种干净、明快的实物观感。
 */
function drawFaceColor(
  ctx: CanvasRenderingContext2D,
  size: number,
  dots: [number, number][],
  faceIndex: number,
  pipRadius: number,
) {
  const baseGradient = ctx.createLinearGradient(0, 0, size, size)
  baseGradient.addColorStop(0, '#fffaf2')
  baseGradient.addColorStop(0.62, '#f7efe4')
  baseGradient.addColorStop(1, '#eee4d6')
  ctx.fillStyle = baseGradient
  ctx.fillRect(0, 0, size, size)

  const faceInset = size * 0.07
  const faceRadius = size * 0.18

  ctx.save()
  drawRoundedRectPath(ctx, faceInset, faceInset, size - faceInset * 2, size - faceInset * 2, faceRadius)
  ctx.clip()

  const faceLight = ctx.createLinearGradient(size * 0.14, size * 0.12, size * 0.86, size * 0.88)
  faceLight.addColorStop(0, 'rgba(255, 255, 255, 0.16)')
  faceLight.addColorStop(0.55, 'rgba(255, 255, 255, 0.05)')
  faceLight.addColorStop(1, 'rgba(0, 0, 0, 0.025)')
  ctx.fillStyle = faceLight
  ctx.fillRect(0, 0, size, size)
  ctx.restore()

  ctx.save()
  drawRoundedRectPath(ctx, faceInset, faceInset, size - faceInset * 2, size - faceInset * 2, faceRadius)
  ctx.strokeStyle = 'rgba(103, 82, 53, 0.055)'
  ctx.lineWidth = size * 0.012
  ctx.stroke()
  ctx.restore()

  ctx.fillStyle = pipColor(faceIndex)

  for (const [u, v] of dots) {
    const x = u * size
    const y = v * size
    ctx.beginPath()
    ctx.arc(x, y, pipRadius * 0.8, 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * 骰子面纹理生成器（Canvas 2D 绘制）
 * 返回 6 个面的颜色图；默认优先保持骰面干净、点数清晰。
 */
function createDiceTextures(): DiceFaceTextureSet[] {
  if (cachedCanvasFaceTextures) return cachedCanvasFaceTextures

  const size = 384
  const pipRadius = size * 0.092

  cachedCanvasFaceTextures = DOT_POSITIONS.map((dots, index) => {
    const colorCanvas = createCanvas(size)

    drawFaceColor(colorCanvas.getContext('2d')!, size, dots, index, pipRadius)

    return {
      map: createCanvasTexture(colorCanvas, true),
    }
  })

  return cachedCanvasFaceTextures
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
  const textures = activeTextureSource.createTextures().map(normalizeFaceTextures)
  const materials = FACE_MAP.materialOrder.map(
    (faceValue) =>
      new THREE.MeshPhysicalMaterial({
        map: textures[faceValue - 1].map,
        roughness: 0.62,
        metalness: 0.01,
        clearcoat: 0.12,
        clearcoatRoughness: 0.2,
        envMapIntensity: 0.22,
      }),
  )

  // 视觉网格允许独立倒角，保留 box 物理碰撞体的同时改善显示观感。
  const chamferRadius = hs * PHYSICS.diceVisualChamferRatio
  const geometry = chamferRadius > 0
    ? new RoundedBoxGeometry(hs * 2, hs * 2, hs * 2, 6, chamferRadius)
    : new THREE.BoxGeometry(hs * 2, hs * 2, hs * 2)
  const mesh = new THREE.Mesh(geometry, materials)
  mesh.castShadow = true
  mesh.receiveShadow = true

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
