import * as THREE from 'three'

export interface SceneContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  /** 同步 canvas 尺寸 / DPR / camera aspect */
  handleResize: () => void
  dispose: () => void
}

/**
 * 创建 Three.js 场景、摄像机、渲染器、灯光
 * 摄像机固定俯视 + 轻微倾斜，不可交互调节
 */
export function createScene(canvas: HTMLCanvasElement): SceneContext {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a2e)

  // 渲染器
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  // 摄像机：俯视 + 轻微倾斜
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(0, 8, 4)
  camera.lookAt(0, 0, 0)

  // 主光源：暖色调方向光
  const dirLight = new THREE.DirectionalLight(0xffeedd, 1.5)
  dirLight.position.set(3, 8, 4)
  dirLight.castShadow = true
  dirLight.shadow.mapSize.set(1024, 1024)
  dirLight.shadow.camera.near = 0.5
  dirLight.shadow.camera.far = 20
  dirLight.shadow.camera.left = -5
  dirLight.shadow.camera.right = 5
  dirLight.shadow.camera.top = 5
  dirLight.shadow.camera.bottom = -5
  scene.add(dirLight)

  // 环境光：柔和补光
  const ambientLight = new THREE.AmbientLight(0xfff5e6, 0.6)
  scene.add(ambientLight)

  // 半球光：增加底部环境反射
  const hemiLight = new THREE.HemisphereLight(0xffeedd, 0x8d6e4c, 0.3)
  scene.add(hemiLight)

  const handleResize = () => {
    const parent = canvas.parentElement
    if (!parent) return
    const w = parent.clientWidth
    const h = parent.clientHeight
    renderer.setSize(w, h, false)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  // 初始 resize
  handleResize()

  const resizeObserver = new ResizeObserver(handleResize)
  const parent = canvas.parentElement
  if (parent) resizeObserver.observe(parent)

  const dispose = () => {
    resizeObserver.disconnect()
    renderer.dispose()
  }

  return { scene, camera, renderer, handleResize, dispose }
}
