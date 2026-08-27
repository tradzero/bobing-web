import * as THREE from 'three'
import {
  BOWL_HEIGHT,
  BOWL_THICKNESS,
  BOWL_INNER_RADIUS,
  sampleBowlInnerProfile,
} from '@/config/bowl'
import bowlPatternUrl from '@/assets/bowl-blue-white-seamless-v2.webp'

/** 视觉碗内壁采样段数（48 段保证俯视近景曲线光滑） */
const SEGMENTS = 48

/** 碗口圆角翻边采样点数 */
const RIM_ARC_STEPS = 4

export interface CreateBowlOptions {
  /** 贴图成功写入或确认使用回退后通知场景可以首屏展示。 */
  onPatternReady?: () => void
}

const pendingPatternLoadDisposers = new WeakMap<THREE.Group, () => void>()

function createBowlPatternTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 512

  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // 稍暖的瓷白底避免高光区域变成没有层次的纯白。
  ctx.fillStyle = '#f8f4ec'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const stripeColor = '#37698f'
  const motifColor = '#2d5f86'
  const softColor = 'rgba(50, 98, 137, 0.44)'

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  ctx.strokeStyle = stripeColor
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, 58)
  ctx.lineTo(canvas.width, 58)
  ctx.moveTo(0, 70)
  ctx.lineTo(canvas.width, 70)
  ctx.moveTo(0, 116)
  ctx.lineTo(canvas.width, 116)
  ctx.stroke()

  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, 124)
  ctx.lineTo(canvas.width, 124)
  ctx.moveTo(0, 344)
  ctx.lineTo(canvas.width, 344)
  ctx.moveTo(0, 356)
  ctx.lineTo(canvas.width, 356)
  ctx.stroke()

  // 碗口带使用低矮、连续的云头纹。128px 周期与画布宽度整除，接缝处自然闭合。
  ctx.strokeStyle = motifColor
  ctx.lineWidth = 2.5
  for (let x = -128; x <= canvas.width + 128; x += 128) {
    ctx.beginPath()
    ctx.moveTo(x, 166)
    ctx.bezierCurveTo(x + 14, 154, x + 30, 154, x + 40, 164)
    ctx.bezierCurveTo(x + 48, 172, x + 58, 172, x + 64, 164)
    ctx.bezierCurveTo(x + 72, 154, x + 88, 154, x + 100, 166)
    ctx.bezierCurveTo(x + 108, 174, x + 120, 174, x + 128, 166)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(x + 40, 164)
    ctx.quadraticCurveTo(x + 51, 148, x + 62, 164)
    ctx.quadraticCurveTo(x + 55, 168, x + 48, 164)
    ctx.stroke()
  }

  // 中段用细折枝带取代大团花，图案只承担边饰作用，不与骰子争夺视觉焦点。
  ctx.strokeStyle = softColor
  ctx.lineWidth = 2
  for (let x = -128; x <= canvas.width + 128; x += 128) {
    ctx.beginPath()
    ctx.moveTo(x, 252)
    ctx.bezierCurveTo(x + 36, 244, x + 88, 260, x + 128, 250)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(x + 34, 249)
    ctx.quadraticCurveTo(x + 42, 237, x + 50, 246)
    ctx.quadraticCurveTo(x + 43, 252, x + 34, 249)
    ctx.moveTo(x + 81, 254)
    ctx.quadraticCurveTo(x + 89, 264, x + 98, 254)
    ctx.quadraticCurveTo(x + 90, 249, x + 81, 254)
    ctx.stroke()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  return texture
}

function configureBowlPattern(texture: THREE.Texture): THREE.Texture {
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.wrapS = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

function loadBowlPatternImage(
  material: THREE.MeshPhysicalMaterial,
  texture: THREE.Texture,
  onPatternReady?: () => void,
): () => void {
  if (typeof document === 'undefined') return () => undefined

  let disposed = false
  let settled = false
  const settle = () => {
    if (settled || disposed) return
    settled = true
    window.clearTimeout(timeoutId)
    onPatternReady?.()
  }

  const settleWithFallback = () => {
    if (settled || disposed) return
    const fallback = createBowlPatternTexture()
    if (fallback) {
      material.map = configureBowlPattern(fallback)
      material.needsUpdate = true
      texture.dispose()
    }
    settle()
  }

  const timeoutId = window.setTimeout(settleWithFallback, 8_000)

  new THREE.ImageLoader().load(
    bowlPatternUrl,
    (image) => {
      if (disposed || settled) return

      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height
      if (width <= 0 || height <= 0) {
        settleWithFallback()
        return
      }

      // 直接把解码后的 HTMLImageElement 交给 Three 上传，避免在已上传的
      // CanvasTexture 上改尺寸/重画后，不同 WebGL 实现仍沿用旧像素。
      texture.image = image
      texture.needsUpdate = true
      settle()
    },
    undefined,
    () => {
      settleWithFallback()
    },
  )

  return () => {
    disposed = true
    window.clearTimeout(timeoutId)
  }
}

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

  // 不再收敛到中心 (0,0)，避免 LatheGeometry 极点法线奇异
  // 碗底平面由独立 CircleGeometry 底盖覆盖

  return points
}

/**
 * 创建海碗可视模型
 * LatheGeometry 旋转体生成碗壁 + 独立 CircleGeometry 底盖
 * 避免 Lathe 极点法线奇异导致的星芒伪影
 */
export function createBowl(options: CreateBowlOptions = {}): THREE.Group {
  const points = generateBowlProfile()
  const pattern = configureBowlPattern(new THREE.Texture())

  // 128 圆周分段消除俯视棱线和摩尔纹，碗仅一个，性能可忽略
  const geometry = new THREE.LatheGeometry(points, 128)
  // 骨瓷仍保留柔和釉感，但避免低粗糙度和满 clearcoat 形成硬白热点。
  const wallMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf7f3ee,
    map: pattern,
    roughness: 0.28,
    metalness: 0.02,
    envMapIntensity: 0.8,
    clearcoat: 0.58,
    clearcoatRoughness: 0.16,
    side: THREE.DoubleSide,
  })
  const disposePendingPatternLoad = loadBowlPatternImage(
    wallMaterial,
    pattern,
    options.onPatternReady,
  )
  const mesh = new THREE.Mesh(geometry, wallMaterial)
  // LatheGeometry 的 UV 接缝初始位于 +Z；固定相机也从 +Z 看向碗心。
  // 总旋转 180° 把残余压缩差放到 -Z 后壁，由远侧碗沿遮住，而不是落在左右可见内壁。
  mesh.rotation.y = Math.PI
  mesh.castShadow = true
  mesh.receiveShadow = true

  // 独立底盖：最小遮缝策略，从上方微量盖住 Lathe 末端边缘
  // 分段与碗体一致（128）避免内接多边形不吻合
  const lastPoint = points[points.length - 1]
  const CAP_R_EXPAND = 0.001 // 半径外扩，仅遮缝不暴露底盖
  const CAP_Y_LIFT = 0.0001 // 微量上浮，从上方盖住接缝避免透出桌面
  const capGeo = new THREE.CircleGeometry(lastPoint.x + CAP_R_EXPAND, 128)
  const capMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xfdf8f1,
    roughness: 0.24,
    metalness: 0.01,
    envMapIntensity: 0.8,
    clearcoat: 0.55,
    clearcoatRoughness: 0.18,
  })
  const cap = new THREE.Mesh(capGeo, capMaterial)
  // CircleGeometry 默认面朝 +Z，旋转到 XZ 平面使法线朝 +Y（碗内侧）
  cap.rotation.x = -Math.PI / 2
  cap.position.y = lastPoint.y + CAP_Y_LIFT
  cap.castShadow = false
  cap.receiveShadow = true

  const group = new THREE.Group()
  group.add(mesh)
  group.add(cap)
  pendingPatternLoadDisposers.set(group, disposePendingPatternLoad)
  return group
}

/** 在场景材质统一释放前取消尚未结束的异步贴图所有权。 */
export function disposeBowlPatternLoad(bowl: THREE.Group): void {
  pendingPatternLoadDisposers.get(bowl)?.()
  pendingPatternLoadDisposers.delete(bowl)
}
