import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { PHYSICS } from '@dice/physics-core/config/physics'
import { createDiceBody } from '@dice/physics-core/dice/dice-body'
import { DICE_RENDER } from '@/config/render'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

/** 骰子 mesh 与 body 的配对 */
export interface DicePair {
  mesh: THREE.Object3D
  body: CANNON.Body
  /**
   * 将 mesh 上的代理姿态提交给真正的渲染对象。
   * 普通单颗 Mesh 不需要此回调；InstancedMesh 用它更新对应的 instance matrix。
   */
  syncVisual?: () => void
}

/** 骰子数量 */
export const DICE_COUNT = 6

/** 六颗骰子的共享渲染资源与物理配对。 */
export interface DiceSet {
  pairs: DicePair[]
  object3d: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>
  /** 释放该 DiceSet 独占的 instance buffer、geometry、material 和 atlas texture。 */
  dispose: () => void
}

export interface DiceFaceTextureSet {
  map: THREE.Texture
  bumpMap?: THREE.Texture
  roughnessMap?: THREE.Texture
}

/** 纹理来源策略接口（支持后续替换为静态 atlas 加载）。 */
export interface DiceTextureSource {
  /** 返回包含点数 1~6 的 3×2 atlas；布局由 DICE_ATLAS 固定。 */
  createAtlas(): DiceFaceTextureSet
}

/**
 * 默认纹理来源：Canvas 2D 绘制
 * 四点面为红色，其余面为黑色
 */
export const canvasTextureSource: DiceTextureSource = {
  createAtlas: createDiceTextureAtlas,
}

/** 当前使用的纹理来源（可通过 setTextureSource 替换） */
let activeTextureSource: DiceTextureSource = canvasTextureSource

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
  drawRoundedRectPath(
    ctx,
    faceInset,
    faceInset,
    size - faceInset * 2,
    size - faceInset * 2,
    faceRadius,
  )
  ctx.clip()

  const faceLight = ctx.createLinearGradient(size * 0.14, size * 0.12, size * 0.86, size * 0.88)
  faceLight.addColorStop(0, 'rgba(255, 255, 255, 0.16)')
  faceLight.addColorStop(0.55, 'rgba(255, 255, 255, 0.05)')
  faceLight.addColorStop(1, 'rgba(0, 0, 0, 0.025)')
  ctx.fillStyle = faceLight
  ctx.fillRect(0, 0, size, size)
  ctx.restore()

  ctx.save()
  drawRoundedRectPath(
    ctx,
    faceInset,
    faceInset,
    size - faceInset * 2,
    size - faceInset * 2,
    faceRadius,
  )
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
 * 单材质骰面 atlas。每格保留挤出的边缘 gutter，降低线性过滤与 mipmap
 * 在格子交界处串色的风险；点数仍按 1→6 从左到右、从上到下排列。
 */
export const DICE_ATLAS = {
  columns: 3,
  rows: 2,
  faceSize: 384,
  gutter: 8,
} as const

function drawExtrudedAtlasTile(
  ctx: CanvasRenderingContext2D,
  faceCanvas: HTMLCanvasElement,
  tileX: number,
  tileY: number,
): void {
  const { faceSize, gutter } = DICE_ATLAS
  const innerX = tileX + gutter
  const innerY = tileY + gutter

  ctx.drawImage(faceCanvas, innerX, innerY)
  ctx.drawImage(faceCanvas, 0, 0, faceSize, 1, innerX, tileY, faceSize, gutter)
  ctx.drawImage(
    faceCanvas,
    0,
    faceSize - 1,
    faceSize,
    1,
    innerX,
    innerY + faceSize,
    faceSize,
    gutter,
  )
  ctx.drawImage(faceCanvas, 0, 0, 1, faceSize, tileX, innerY, gutter, faceSize)
  ctx.drawImage(
    faceCanvas,
    faceSize - 1,
    0,
    1,
    faceSize,
    innerX + faceSize,
    innerY,
    gutter,
    faceSize,
  )

  // 四角同样挤出，避免各向异性采样落到透明像素。
  ctx.drawImage(faceCanvas, 0, 0, 1, 1, tileX, tileY, gutter, gutter)
  ctx.drawImage(faceCanvas, faceSize - 1, 0, 1, 1, innerX + faceSize, tileY, gutter, gutter)
  ctx.drawImage(faceCanvas, 0, faceSize - 1, 1, 1, tileX, innerY + faceSize, gutter, gutter)
  ctx.drawImage(
    faceCanvas,
    faceSize - 1,
    faceSize - 1,
    1,
    1,
    innerX + faceSize,
    innerY + faceSize,
    gutter,
    gutter,
  )
}

function createDiceTextureAtlas(): DiceFaceTextureSet {
  const { columns, rows, faceSize, gutter } = DICE_ATLAS
  const cellSize = faceSize + gutter * 2
  const atlasCanvas = createCanvas(columns * cellSize)
  atlasCanvas.height = rows * cellSize
  const atlasContext = atlasCanvas.getContext('2d')!
  const pipRadius = faceSize * 0.092

  DOT_POSITIONS.forEach((dots, faceIndex) => {
    const faceCanvas = createCanvas(faceSize)
    drawFaceColor(faceCanvas.getContext('2d')!, faceSize, dots, faceIndex, pipRadius)
    const column = faceIndex % columns
    const row = Math.floor(faceIndex / columns)
    drawExtrudedAtlasTile(atlasContext, faceCanvas, column * cellSize, row * cellSize)
  })

  return { map: createCanvasTexture(atlasCanvas, true) }
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

interface DiceVisualResources {
  geometry: THREE.BufferGeometry
  material: THREE.MeshPhysicalMaterial
}

function remapGeometryToAtlas(geometry: THREE.BufferGeometry): void {
  const uv = geometry.getAttribute('uv')
  if (!(uv instanceof THREE.BufferAttribute)) {
    throw new TypeError('Dice geometry must provide a BufferAttribute UV channel')
  }
  if (geometry.groups.length !== FACE_MAP.materialOrder.length) {
    throw new RangeError(
      `Dice geometry must provide exactly 6 face groups; received ${geometry.groups.length}`,
    )
  }

  const originalUv = Array.from(uv.array as ArrayLike<number>)
  const { columns, rows, faceSize, gutter } = DICE_ATLAS
  const cellSize = faceSize + gutter * 2
  const atlasWidth = columns * cellSize
  const atlasHeight = rows * cellSize

  geometry.groups.forEach((group, groupIndex) => {
    const faceValue = FACE_MAP.materialOrder[groupIndex]
    const column = (faceValue - 1) % columns
    const row = Math.floor((faceValue - 1) / columns)
    const uMin = (column * cellSize + gutter) / atlasWidth
    const uSize = faceSize / atlasWidth
    // CanvasTexture 默认 flipY=true：atlas 顶行对应较高的纹理 v。
    const vMin = 1 - (row * cellSize + gutter + faceSize) / atlasHeight
    const vSize = faceSize / atlasHeight

    for (let offset = group.start; offset < group.start + group.count; offset++) {
      const vertexIndex = geometry.index ? geometry.index.getX(offset) : offset
      const sourceU = originalUv[vertexIndex * 2]
      const sourceV = originalUv[vertexIndex * 2 + 1]
      uv.setXY(vertexIndex, uMin + sourceU * uSize, vMin + sourceV * vSize)
    }
  })

  uv.needsUpdate = true
  const drawCount = geometry.index?.count ?? geometry.getAttribute('position').count
  geometry.clearGroups()
  geometry.addGroup(0, drawCount, 0)
}

/**
 * 创建一组骰子视觉资源。调用者拥有返回值，禁止跨 DiceSet 缓存：
 * StrictMode 重挂载时，新集合不能复用上一个集合已 dispose 的贴图。
 */
function createVisualResources(): DiceVisualResources {
  const atlas = activeTextureSource.createAtlas()
  const material = new THREE.MeshPhysicalMaterial({
    map: atlas.map,
    ...(atlas.bumpMap ? { bumpMap: atlas.bumpMap } : {}),
    ...(atlas.roughnessMap ? { roughnessMap: atlas.roughnessMap } : {}),
    roughness: 0.62,
    metalness: 0.01,
    clearcoat: 0.12,
    clearcoatRoughness: 0.2,
    envMapIntensity: 0.22,
  })

  const hs = PHYSICS.diceHalfSize
  const chamferRadius = hs * DICE_RENDER.chamferRatio
  const geometry =
    chamferRadius > 0
      ? new RoundedBoxGeometry(hs * 2, hs * 2, hs * 2, DICE_RENDER.segments, chamferRadius)
      : new THREE.BoxGeometry(hs * 2, hs * 2, hs * 2)
  remapGeometryToAtlas(geometry)

  return { geometry, material }
}

function disposeVisualResources(resources: DiceVisualResources): void {
  const textures = new Set<THREE.Texture>()
  for (const value of Object.values(resources.material)) {
    if (value instanceof THREE.Texture) textures.add(value)
  }

  for (const texture of textures) texture.dispose()
  resources.material.dispose()
  resources.geometry.dispose()
}

/**
 * 批量创建 6 颗骰子。
 *
 * 视觉层只有一个单材质 InstancedMesh；六面通过 UV 映射到同一张 atlas，
 * 因此主渲染和阴影 pass 中骰子都只需要一次 instanced draw。
 */
export function createDiceSet(): DiceSet {
  const resources = createVisualResources()
  const object3d = new THREE.InstancedMesh(resources.geometry, resources.material, DICE_COUNT)
  object3d.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  object3d.castShadow = true
  object3d.receiveShadow = true

  // instance 姿态每帧都会变；关闭对该单一小对象的视锥剪枝，避免动态包围球过期导致骰子被误剪。
  object3d.frustumCulled = false

  const pairs = Array.from({ length: DICE_COUNT }, (_, instanceIndex): DicePair => {
    const mesh = new THREE.Object3D()
    const body = createDiceBody()

    const syncVisual = () => {
      mesh.updateMatrix()
      object3d.setMatrixAt(instanceIndex, mesh.matrix)
      object3d.instanceMatrix.needsUpdate = true
    }

    // 确保第一次渲染前 instance buffer 已明确初始化。
    syncVisual()
    return { mesh, body, syncVisual }
  })

  let disposed = false
  return {
    pairs,
    object3d,
    dispose: () => {
      if (disposed) return
      disposed = true
      object3d.dispose()
      disposeVisualResources(resources)
    },
  }
}
