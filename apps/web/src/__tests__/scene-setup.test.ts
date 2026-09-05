import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const threeMocks = vi.hoisted(() => ({
  rendererInstances: [] as Array<{
    setPixelRatio: ReturnType<typeof vi.fn>
    setSize: ReturnType<typeof vi.fn>
    shadowMap: {
      enabled: boolean
      type: unknown
      autoUpdate: boolean
      needsUpdate: boolean
    }
    dispose: ReturnType<typeof vi.fn>
  }>,
  directionalLights: [] as Array<{
    shadow: {
      mapSize: { set: ReturnType<typeof vi.fn> }
      map: { dispose: ReturnType<typeof vi.fn> } | null
      normalBias: number
      camera: Record<string, number>
    }
  }>,
  pmremConstructor: vi.fn(),
}))

vi.mock('three', () => {
  class Scene {
    background: unknown = null
    environment: unknown = null
    add = vi.fn()
  }

  class Color {
    value: number

    constructor(value: number) {
      this.value = value
    }
  }

  class WebGLRenderer {
    setPixelRatio = vi.fn()
    setSize = vi.fn()
    shadowMap = {
      enabled: false,
      type: null as unknown,
      autoUpdate: true,
      needsUpdate: false,
    }
    dispose = vi.fn()

    constructor(options: unknown) {
      void options
      threeMocks.rendererInstances.push(this)
    }
  }

  class PerspectiveCamera {
    position = { set: vi.fn() }
    lookAt = vi.fn()
    updateProjectionMatrix = vi.fn()
    aspect = 1
    fov: number

    constructor(fov: number) {
      this.fov = fov
    }
  }

  class DirectionalLight {
    position = { set: vi.fn() }
    castShadow = false
    shadow = {
      mapSize: { set: vi.fn() },
      map: null as { dispose: ReturnType<typeof vi.fn> } | null,
      normalBias: 0,
      camera: {} as Record<string, number>,
    }

    constructor(color: number, intensity: number) {
      void color
      void intensity
      threeMocks.directionalLights.push(this)
    }
  }

  class AmbientLight {}

  class HemisphereLight {}

  class PMREMGenerator {
    compileEquirectangularShader = vi.fn()
    fromScene = vi.fn(() => ({ texture: {} }))
    dispose = vi.fn()

    constructor(renderer: unknown) {
      void renderer
      threeMocks.pmremConstructor()
    }
  }

  return {
    Scene,
    Color,
    WebGLRenderer,
    PerspectiveCamera,
    DirectionalLight,
    AmbientLight,
    HemisphereLight,
    PMREMGenerator,
    PCFShadowMap: 'PCFShadowMap',
  }
})

import { createScene } from '@/scene/setup'

describe('场景 resize 与渲染失效', () => {
  let observedCallback: (() => void) | null
  let disconnect: ReturnType<typeof vi.fn>

  beforeEach(() => {
    threeMocks.rendererInstances.length = 0
    threeMocks.directionalLights.length = 0
    threeMocks.pmremConstructor.mockClear()
    observedCallback = null
    disconnect = vi.fn()

    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observedCallback = callback
        }

        observe = vi.fn()
        disconnect = disconnect
      },
    )
    vi.stubGlobal('devicePixelRatio', 2)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('慢帧降低 rolling 分辨率，静态恢复清晰度且下轮保留档位', () => {
    const parent = document.createElement('div')
    Object.defineProperty(parent, 'clientWidth', { value: 1280 })
    Object.defineProperty(parent, 'clientHeight', { value: 720 })
    const canvas = document.createElement('canvas')
    parent.appendChild(canvas)
    const context = createScene(canvas, { rollingDprPreset: 'adaptive' })
    const renderer = threeMocks.rendererInstances[0]
    context.setRenderPhase?.('rolling')
    for (let i = 0; i < 12; i++) context.observeRollingFrame?.(80)
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(0.75)
    context.setRenderPhase?.('static')
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1.5)
    context.setRenderPhase?.('rolling')
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(0.75)
    expect(threeMocks.directionalLights[0].shadow.mapSize.set).toHaveBeenCalledOnce()
    context.dispose()
  })

  it('初始化质量、阴影按需更新，并跳过完全相同的 resize', () => {
    let width = 1280
    let height = 720
    const parent = document.createElement('div')
    Object.defineProperty(parent, 'clientWidth', { configurable: true, get: () => width })
    Object.defineProperty(parent, 'clientHeight', { configurable: true, get: () => height })
    const canvas = document.createElement('canvas')
    parent.appendChild(canvas)

    const context = createScene(canvas)
    const renderer = threeMocks.rendererInstances[0]
    const light = threeMocks.directionalLights[0]

    expect(renderer.setPixelRatio).toHaveBeenCalledOnce()
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1.5)
    expect(renderer.setSize).toHaveBeenLastCalledWith(1280, 720, false)
    expect(renderer.shadowMap.autoUpdate).toBe(false)
    expect(renderer.shadowMap.needsUpdate).toBe(true)
    expect(light.shadow.mapSize.set).toHaveBeenLastCalledWith(1024, 1024)

    const invalidate = vi.fn()
    context.setRenderInvalidationCallback?.(invalidate)

    expect(context.getRenderQualityDiagnostics?.()).toEqual({
      phase: 'static',
      rollingDprPreset: 'baseline',
      basePixelRatio: 1.5,
      effectivePixelRatio: 1.5,
      tier: 'full',
      shadowMapSize: 1024,
    })
    context.setRenderPhase?.('rolling')
    expect(renderer.setPixelRatio).toHaveBeenCalledOnce()
    expect(renderer.setSize).toHaveBeenCalledOnce()
    expect(invalidate).not.toHaveBeenCalled()
    expect(context.getRenderQualityDiagnostics?.()).toMatchObject({
      phase: 'rolling',
      rollingDprPreset: 'baseline',
      basePixelRatio: 1.5,
      effectivePixelRatio: 1.5,
    })

    observedCallback?.()

    expect(renderer.setSize).toHaveBeenCalledOnce()
    expect(renderer.setPixelRatio).toHaveBeenCalledOnce()
    expect(invalidate).not.toHaveBeenCalled()

    const oldShadowMap = { dispose: vi.fn() }
    light.shadow.map = oldShadowMap
    width = 1920
    height = 1080
    observedCallback?.()

    expect(renderer.setSize).toHaveBeenCalledTimes(2)
    expect(renderer.setPixelRatio).toHaveBeenCalledTimes(2)
    expect(renderer.setPixelRatio.mock.calls[1][0]).toBeLessThan(1.5)
    expect(light.shadow.mapSize.set).toHaveBeenLastCalledWith(512, 512)
    expect(oldShadowMap.dispose).toHaveBeenCalledOnce()
    expect(light.shadow.map).toBeNull()
    expect(invalidate).toHaveBeenCalledOnce()

    context.clearRenderInvalidationCallback?.()
    width = 1600
    observedCallback?.()
    expect(invalidate).toHaveBeenCalledOnce()

    context.dispose()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(renderer.dispose).toHaveBeenCalledOnce()
  })

  it('纯色背景与灯光场景不生成低价值 PMREM 资源', () => {
    const parent = document.createElement('div')
    Object.defineProperty(parent, 'clientWidth', { configurable: true, value: 1280 })
    Object.defineProperty(parent, 'clientHeight', { configurable: true, value: 720 })
    const canvas = document.createElement('canvas')
    parent.appendChild(canvas)

    const context = createScene(canvas)

    expect(threeMocks.pmremConstructor).not.toHaveBeenCalled()
    expect(context.scene.environment).toBeNull()

    context.dispose()
    expect(threeMocks.rendererInstances[0].dispose).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('保持移动竖屏摄像机预设', () => {
    const parent = document.createElement('div')
    Object.defineProperty(parent, 'clientWidth', { configurable: true, value: 390 })
    Object.defineProperty(parent, 'clientHeight', { configurable: true, value: 844 })
    const canvas = document.createElement('canvas')
    parent.appendChild(canvas)

    const context = createScene(canvas)

    expect(context.camera.fov).toBe(45)
    expect(context.camera.position.set).toHaveBeenLastCalledWith(0, 4, 3.2)
  })

  it('尺寸不变但设备 DPR 改变时重新配置并通知', () => {
    const parent = document.createElement('div')
    Object.defineProperty(parent, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(parent, 'clientHeight', { configurable: true, value: 600 })
    const canvas = document.createElement('canvas')
    parent.appendChild(canvas)

    const context = createScene(canvas)
    const renderer = threeMocks.rendererInstances[0]
    const invalidate = vi.fn()
    context.setRenderInvalidationCallback?.(invalidate)

    vi.stubGlobal('devicePixelRatio', 1)
    observedCallback?.()

    expect(renderer.setSize).toHaveBeenCalledTimes(2)
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1)
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it('生产 DPR preset 只在 reduced 基础质量档的 rolling 阶段切换为 1x', () => {
    let width = 1280
    let height = 720
    const parent = document.createElement('div')
    Object.defineProperty(parent, 'clientWidth', { configurable: true, get: () => width })
    Object.defineProperty(parent, 'clientHeight', { configurable: true, get: () => height })
    const canvas = document.createElement('canvas')
    parent.appendChild(canvas)

    const context = createScene(canvas, { rollingDprPreset: 'cap-1x-reduced-tier' })
    const renderer = threeMocks.rendererInstances[0]

    context.setRenderPhase?.('rolling')
    expect(renderer.setPixelRatio).toHaveBeenCalledOnce()
    expect(context.getRenderQualityDiagnostics?.()).toEqual({
      phase: 'rolling',
      rollingDprPreset: 'cap-1x-reduced-tier',
      basePixelRatio: 1.5,
      effectivePixelRatio: 1.5,
      tier: 'full',
      shadowMapSize: 1024,
    })

    width = 1920
    height = 1080
    observedCallback?.()

    const rollingQuality = context.getRenderQualityDiagnostics?.()
    if (!rollingQuality) throw new Error('expected render quality diagnostics after resize')
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1)
    expect(rollingQuality).toMatchObject({
      phase: 'rolling',
      rollingDprPreset: 'cap-1x-reduced-tier',
      effectivePixelRatio: 1,
      tier: 'reduced',
      shadowMapSize: 512,
    })
    expect(rollingQuality.basePixelRatio).toBeGreaterThan(1)

    context.setRenderPhase?.('static')
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(rollingQuality.basePixelRatio)
  })

  it('cap-1x 只在 rolling 切换 DPR，保持基础质量与阴影档位且不触发失效回调', () => {
    let width = 1280
    let height = 720
    const parent = document.createElement('div')
    Object.defineProperty(parent, 'clientWidth', { configurable: true, get: () => width })
    Object.defineProperty(parent, 'clientHeight', { configurable: true, get: () => height })
    const canvas = document.createElement('canvas')
    parent.appendChild(canvas)

    const context = createScene(canvas, { rollingDprPreset: 'cap-1x' })
    const renderer = threeMocks.rendererInstances[0]
    const light = threeMocks.directionalLights[0]
    const invalidate = vi.fn()
    context.setRenderInvalidationCallback?.(invalidate)

    expect(context.getRenderQualityDiagnostics?.()).toEqual({
      phase: 'static',
      rollingDprPreset: 'cap-1x',
      basePixelRatio: 1.5,
      effectivePixelRatio: 1.5,
      tier: 'full',
      shadowMapSize: 1024,
    })

    context.setRenderPhase?.('rolling')
    expect(renderer.setPixelRatio).toHaveBeenCalledTimes(2)
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1)
    expect(renderer.setSize).toHaveBeenCalledOnce()
    expect(light.shadow.mapSize.set).toHaveBeenCalledOnce()
    expect(invalidate).not.toHaveBeenCalled()
    expect(context.getRenderQualityDiagnostics?.()).toEqual({
      phase: 'rolling',
      rollingDprPreset: 'cap-1x',
      basePixelRatio: 1.5,
      effectivePixelRatio: 1,
      tier: 'full',
      shadowMapSize: 1024,
    })

    context.setRenderPhase?.('rolling')
    expect(renderer.setPixelRatio).toHaveBeenCalledTimes(2)
    expect(renderer.setSize).toHaveBeenCalledOnce()

    const oldShadowMap = { dispose: vi.fn() }
    light.shadow.map = oldShadowMap
    width = 1920
    height = 1080
    observedCallback?.()

    expect(renderer.setPixelRatio).toHaveBeenCalledTimes(3)
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1)
    expect(renderer.setSize).toHaveBeenCalledTimes(2)
    expect(light.shadow.mapSize.set).toHaveBeenCalledTimes(2)
    expect(light.shadow.mapSize.set).toHaveBeenLastCalledWith(512, 512)
    expect(oldShadowMap.dispose).toHaveBeenCalledOnce()
    expect(invalidate).toHaveBeenCalledOnce()

    const rollingQuality = context.getRenderQualityDiagnostics?.()
    if (!rollingQuality) throw new Error('expected render quality diagnostics after resize')
    expect(rollingQuality).toMatchObject({
      phase: 'rolling',
      rollingDprPreset: 'cap-1x',
      effectivePixelRatio: 1,
      tier: 'reduced',
      shadowMapSize: 512,
    })
    expect(rollingQuality.basePixelRatio).toBeGreaterThan(1)

    context.setRenderPhase?.('static')
    expect(renderer.setPixelRatio).toHaveBeenCalledTimes(4)
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(rollingQuality.basePixelRatio)
    expect(renderer.setSize).toHaveBeenCalledTimes(2)
    expect(light.shadow.mapSize.set).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledOnce()
    expect(context.getRenderQualityDiagnostics?.()).toEqual({
      ...rollingQuality,
      phase: 'static',
      effectivePixelRatio: rollingQuality.basePixelRatio,
    })

    context.setRenderPhase?.('static')
    expect(renderer.setPixelRatio).toHaveBeenCalledTimes(4)
    expect(renderer.setSize).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledOnce()
  })
})
