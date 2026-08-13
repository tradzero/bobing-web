import { useRef, useEffect, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { createScene } from '@/scene/setup'
import { createTable } from '@/scene/table'
import { createBowl } from '@/scene/bowl'
import { createPhysicsWorld } from '@/physics/world'
import { setupContactMaterials } from '@/physics/materials'
import { createBowlBodies } from '@/physics/bowl-body'
import { createDiceSet } from '@/dice/create'
import { placeDiceAtRest } from '@/dice/rest'
import { createEngine, type EngineDiagnostics } from '@/game/engine'
import { createGameStore } from '@/game/store'
import { GameController } from '@/game/controller'
import { GameControllerContext } from './GameControllerContext'
import { GameStoreContext } from './GameStoreContext'

const DIAGNOSTICS_SCHEMA_VERSION = 2
const DIAGNOSTICS_ENABLED = import.meta.env.DEV || import.meta.env.MODE === 'e2e'

interface GameViewportProps {
  children?: ReactNode
}

interface DiceRuntimeDiagnostics {
  schemaVersion: typeof DIAGNOSTICS_SCHEMA_VERSION
  revision: number
  sampleKind: 'post-render'
  engine: EngineDiagnostics
  roll: ReturnType<GameController['getRollDiagnostics']>
  render: {
    cssWidth: number
    cssHeight: number
    drawingBufferWidth: number
    drawingBufferHeight: number
    drawingBufferPixels: number
    pixelRatio: number
    /** renderer.info 在主 pass 前会重置，这里不把阴影 pass 误计为总调用。 */
    mainPassCalls: number
    mainPassTriangles: number
    geometries: number
    textures: number
    programs: number
  }
}

function readNextSeed(): number | undefined {
  if (!DIAGNOSTICS_ENABLED) return undefined
  const value = new URLSearchParams(window.location.search).get('nextSeed')
  if (value === null || value.trim() === '') return undefined

  const seed = Number(value)
  return Number.isSafeInteger(seed) ? seed : undefined
}

/** 递归释放 scene 中所有 geometry / material / texture */
function disposeSceneResources(scene: THREE.Scene) {
  const disposedGeometries = new Set<THREE.BufferGeometry>()
  const disposedMaterials = new Set<THREE.Material>()
  const disposedTextures = new Set<THREE.Texture>()
  const disposedInstancedMeshes = new Set<THREE.InstancedMesh>()

  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      if (obj instanceof THREE.InstancedMesh && !disposedInstancedMeshes.has(obj)) {
        disposedInstancedMeshes.add(obj)
        obj.dispose()
      }

      if (obj.geometry && !disposedGeometries.has(obj.geometry)) {
        disposedGeometries.add(obj.geometry)
        obj.geometry.dispose()
      }

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const mat of mats) {
        if (mat instanceof THREE.Material && !disposedMaterials.has(mat)) {
          disposedMaterials.add(mat)
          // 释放材质上的所有贴图
          for (const value of Object.values(mat)) {
            if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
              disposedTextures.add(value)
              value.dispose()
            }
          }
          mat.dispose()
        }
      }
    }
  })
}

/**
 * 3D 容器组件
 * 持有 canvas ref，useEffect 中创建/销毁引擎实例（幂等，兼容 StrictMode 双调用）
 * 通过 Provider 包裹 children，确保 overlay 组件能获取 controller 和 store
 */
export function GameViewport({ children }: GameViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [controller, setController] = useState<GameController | null>(null)
  const [store, setStore] = useState<ReturnType<typeof createGameStore> | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 创建 canvas 并插入 canvas host
    const canvasHost = container.querySelector('.canvas-host') as HTMLDivElement
    if (!canvasHost) return
    const canvas = document.createElement('canvas')
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    canvasHost.appendChild(canvas)

    // 初始化场景
    const sceneCtx = createScene(canvas)
    const table = createTable()
    sceneCtx.scene.add(table)
    const bowl = createBowl()
    sceneCtx.scene.add(bowl)

    // 初始化物理
    const physics = createPhysicsWorld()
    setupContactMaterials(physics.world)
    createBowlBodies(physics.world)

    // 创建骰子
    const diceSet = createDiceSet()
    const dicePairs = diceSet.pairs
    sceneCtx.scene.add(diceSet.object3d)
    for (const { body } of dicePairs) {
      physics.world.addBody(body)
    }

    // idle 阶段不推进物理：直接放到可渲染、已同步且休眠的碗底静态姿态。
    placeDiceAtRest(dicePairs)

    // 创建 store、controller、engine
    const gameStore = createGameStore()
    const ctrl = new GameController({
      store: gameStore,
      dicePairs,
      nextSeed: readNextSeed(),
    })

    let diagnosticsRevision = 0
    const publishDiagnostics = (engineDiagnostics: EngineDiagnostics) => {
      if (!DIAGNOSTICS_ENABLED) return
      const drawingBuffer = sceneCtx.renderer.getDrawingBufferSize(new THREE.Vector2())
      const diagnostics: DiceRuntimeDiagnostics = {
        schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
        revision: ++diagnosticsRevision,
        sampleKind: 'post-render',
        engine: engineDiagnostics,
        roll: ctrl.getRollDiagnostics(),
        render: {
          cssWidth: canvas.clientWidth,
          cssHeight: canvas.clientHeight,
          drawingBufferWidth: drawingBuffer.x,
          drawingBufferHeight: drawingBuffer.y,
          drawingBufferPixels: drawingBuffer.x * drawingBuffer.y,
          pixelRatio: sceneCtx.renderer.getPixelRatio(),
          mainPassCalls: sceneCtx.renderer.info.render.calls,
          mainPassTriangles: sceneCtx.renderer.info.render.triangles,
          geometries: sceneCtx.renderer.info.memory.geometries,
          textures: sceneCtx.renderer.info.memory.textures,
          programs: sceneCtx.renderer.info.programs?.length ?? 0,
        },
      }
      canvas.dataset.diceDiagnostics = JSON.stringify(diagnostics)
    }

    const engine = createEngine({
      sceneCtx,
      world: physics.world,
      worldStep: physics.step,
      dicePairs,
      onSettled: (result) => ctrl.onSettled(result),
      onDiagnostics: DIAGNOSTICS_ENABLED ? publishDiagnostics : undefined,
    })

    // 注入 engine（解决循环依赖）
    ctrl.setEngine(engine)
    sceneCtx.setRenderInvalidationCallback?.(engine.invalidate)

    engine.start()
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setStore(gameStore)
      setController(ctrl)
    })

    return () => {
      active = false
      sceneCtx.clearRenderInvalidationCallback?.()
      delete canvas.dataset.diceDiagnostics
      engine.dispose()
      // DiceSet 独占其 instance buffer 和共享骰子资源；先移出 scene，避免通用遍历重复 dispose。
      sceneCtx.scene.remove(diceSet.object3d)
      diceSet.dispose()
      disposeSceneResources(sceneCtx.scene)
      sceneCtx.dispose()
      physics.dispose()
      canvasHost.removeChild(canvas)
    }
  }, [])

  return (
    <GameStoreContext.Provider value={store}>
      <GameControllerContext.Provider value={controller}>
        <div ref={containerRef} className="game-viewport">
          <div className="canvas-host" />
          {controller && children}
        </div>
      </GameControllerContext.Provider>
    </GameStoreContext.Provider>
  )
}
