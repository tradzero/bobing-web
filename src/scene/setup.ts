import * as THREE from 'three'
import {
  resolveRenderPhasePixelRatio,
  resolveRenderQuality,
  type RenderPhase,
  type RenderQuality,
  type RollingDprPreset,
} from '@/config/render'

export type RenderInvalidationCallback = () => void

export interface CreateSceneOptions {
  /** 默认不降级；rolling preset 只改变主画布 DPR。 */
  rollingDprPreset?: RollingDprPreset
}

export interface RenderQualityDiagnostics {
  phase: RenderPhase
  rollingDprPreset: RollingDprPreset
  basePixelRatio: number
  effectivePixelRatio: number
  tier: RenderQuality['tier']
  shadowMapSize: RenderQuality['shadowMapSize']
}

export interface SceneContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  /** 同步 canvas 尺寸 / DPR / camera aspect */
  handleResize: () => void
  /** 注册按需渲染失效回调；保留可选以兼容轻量测试替身。 */
  setRenderInvalidationCallback?: (callback: RenderInvalidationCallback) => void
  /** 清除按需渲染失效回调。 */
  clearRenderInvalidationCallback?: () => void
  /** 切换静态/rolling 主画布质量；真实 SceneContext 必定提供，保留可选以兼容轻量测试替身。 */
  setRenderPhase?: (phase: RenderPhase) => void
  /** 返回最近一次有效 resize 对应的质量快照；canvas 尚无有效尺寸时返回 null。 */
  getRenderQualityDiagnostics?: () => RenderQualityDiagnostics | null
  dispose: () => void
}

/** 桌面端默认机位：相对移动端保留俯视感，但再拉近一点聚焦碗区 */
const DESKTOP_PRESET = { position: [0, 4.6, 4.4] as [number, number, number], fov: 30 }
/** 移动竖屏默认机位：拉近碗区域 */
const MOBILE_PORTRAIT_PRESET = { position: [0, 4.0, 3.2] as [number, number, number], fov: 45 }

/**
 * 根据视口尺寸返回默认摄像机预设
 * 竖屏判定对齐 CSS 断点 768px：w <= 768 且 h > w
 * 未来加交互视角时，可通过跳过 preset 应用来避免冲掉用户状态
 */
function getDefaultCameraPreset(w: number, h: number) {
  return w <= 768 && h > w ? MOBILE_PORTRAIT_PRESET : DESKTOP_PRESET
}

/**
 * 创建 Three.js 场景、摄像机、渲染器、灯光
 * 摄像机固定俯视 + 轻微倾斜，不可交互调节
 */
export function createScene(
  canvas: HTMLCanvasElement,
  options: CreateSceneOptions = {},
): SceneContext {
  const rollingDprPreset = options.rollingDprPreset ?? 'baseline'
  const scene = new THREE.Scene()
  // 中秋暖色调背景：深暖棕色，营造夜晚灯光氛围
  scene.background = new THREE.Color(0x1c1410)

  // 渲染器
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true

  // 摄像机：俯视 + 轻微倾斜
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(0, 8, 4)
  camera.lookAt(0, 0, 0)

  // 主光源：暖色调方向光
  const dirLight = new THREE.DirectionalLight(0xffeedd, 1.5)
  dirLight.position.set(3, 8, 4)
  dirLight.castShadow = true
  dirLight.shadow.normalBias = 0.02
  dirLight.shadow.camera.near = 0.5
  dirLight.shadow.camera.far = 20
  dirLight.shadow.camera.left = -2.5
  dirLight.shadow.camera.right = 2.5
  dirLight.shadow.camera.top = 2.5
  dirLight.shadow.camera.bottom = -2.5
  scene.add(dirLight)

  // 环境光：柔和补光
  const ambientLight = new THREE.AmbientLight(0xfff5e6, 0.6)
  scene.add(ambientLight)

  // 半球光：增加底部环境反射
  const hemiLight = new THREE.HemisphereLight(0xffeedd, 0x8d6e4c, 0.3)
  scene.add(hemiLight)

  let renderInvalidationCallback: RenderInvalidationCallback | null = null
  let lastResize: { width: number; height: number; devicePixelRatio: number } | null = null
  let shadowMapSize: number | null = null
  let renderPhase: RenderPhase = 'static'
  let baseQuality: RenderQuality | null = null
  let effectivePixelRatio: number | null = null

  const setRenderInvalidationCallback = (callback: RenderInvalidationCallback) => {
    renderInvalidationCallback = callback
  }

  const clearRenderInvalidationCallback = () => {
    renderInvalidationCallback = null
  }

  const getRenderQualityDiagnostics = (): RenderQualityDiagnostics | null => {
    if (!baseQuality || effectivePixelRatio === null) return null
    return {
      phase: renderPhase,
      rollingDprPreset,
      basePixelRatio: baseQuality.pixelRatio,
      effectivePixelRatio,
      tier: baseQuality.tier,
      shadowMapSize: baseQuality.shadowMapSize,
    }
  }

  const setRenderPhase = (phase: RenderPhase) => {
    if (renderPhase === phase) return
    renderPhase = phase
    if (!baseQuality) return

    const nextPixelRatio = resolveRenderPhasePixelRatio(
      baseQuality.pixelRatio,
      baseQuality.tier,
      renderPhase,
      rollingDprPreset,
    )
    if (effectivePixelRatio === nextPixelRatio) return

    effectivePixelRatio = nextPixelRatio
    // Three.js setPixelRatio 内部已按当前逻辑尺寸重建 drawing buffer；这里不能再重复 setSize。
    renderer.setPixelRatio(effectivePixelRatio)
    // phase 切换由 Engine 紧邻下一次 render 驱动，不能回调 invalidate 制造额外静态帧。
  }

  const handleResize = () => {
    const parent = canvas.parentElement
    if (!parent) return
    const width = parent.clientWidth
    const height = parent.clientHeight
    if (width <= 0 || height <= 0) return

    const devicePixelRatio =
      Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1
    if (
      lastResize?.width === width &&
      lastResize.height === height &&
      lastResize.devicePixelRatio === devicePixelRatio
    ) {
      return
    }
    lastResize = { width, height, devicePixelRatio }

    const quality = resolveRenderQuality(width, height, devicePixelRatio)
    const nextPixelRatio = resolveRenderPhasePixelRatio(
      quality.pixelRatio,
      quality.tier,
      renderPhase,
      rollingDprPreset,
    )
    baseQuality = quality
    effectivePixelRatio = nextPixelRatio
    renderer.setPixelRatio(nextPixelRatio)
    renderer.setSize(width, height, false)

    if (shadowMapSize !== quality.shadowMapSize) {
      shadowMapSize = quality.shadowMapSize
      dirLight.shadow.map?.dispose()
      dirLight.shadow.map = null
      dirLight.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    }
    renderer.shadowMap.needsUpdate = true

    const w = width
    const h = height
    camera.aspect = w / h

    // 默认视角模式：根据视口尺寸应用摄像机预设
    // 未来加交互视角时，此处改为条件跳过即可
    const preset = getDefaultCameraPreset(w, h)
    camera.position.set(...preset.position)
    camera.fov = preset.fov
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    renderInvalidationCallback?.()
  }

  // 初始 resize
  handleResize()

  const resizeObserver = new ResizeObserver(handleResize)
  const parent = canvas.parentElement
  if (parent) resizeObserver.observe(parent)

  const dispose = () => {
    clearRenderInvalidationCallback()
    resizeObserver.disconnect()
    renderer.dispose()
  }

  return {
    scene,
    camera,
    renderer,
    handleResize,
    setRenderInvalidationCallback,
    clearRenderInvalidationCallback,
    setRenderPhase,
    getRenderQualityDiagnostics,
    dispose,
  }
}
