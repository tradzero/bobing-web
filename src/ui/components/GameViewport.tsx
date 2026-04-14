import { useRef, useEffect, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { createScene } from '@/scene/setup'
import { createTable } from '@/scene/table'
import { createBowl } from '@/scene/bowl'
import { createPhysicsWorld } from '@/physics/world'
import { setupContactMaterials } from '@/physics/materials'
import { createBowlBodies } from '@/physics/bowl-body'
import { createDiceSet } from '@/dice/create'
import { createEngine } from '@/game/engine'
import { createGameStore } from '@/game/store'
import { GameController } from '@/game/controller'
import { GameControllerContext } from './GameControllerContext'
import { GameStoreContext } from './GameStoreContext'

interface GameViewportProps {
  children?: ReactNode
}

/** 递归释放 scene 中所有 geometry / material / texture */
function disposeSceneResources(scene: THREE.Scene) {
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose()
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const mat of mats) {
        if (mat instanceof THREE.Material) {
          // 释放材质上的所有贴图
          for (const value of Object.values(mat)) {
            if (value instanceof THREE.Texture) value.dispose()
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
    const dicePairs = createDiceSet()
    for (const { mesh, body } of dicePairs) {
      sceneCtx.scene.add(mesh)
      physics.world.addBody(body)
    }

    // 骰子初始位置（碗底附近），同步 previousPosition 避免首帧 broadphase 异常
    dicePairs.forEach(({ body }, i) => {
      const angle = (i / dicePairs.length) * Math.PI * 2
      body.position.set(Math.cos(angle) * 0.3, 0.3, Math.sin(angle) * 0.3)
      body.previousPosition.copy(body.position)
      body.aabbNeedsUpdate = true
    })

    // 创建 store、controller、engine
    const gameStore = createGameStore()
    const ctrl = new GameController({
      store: gameStore,
      dicePairs,
    })

    const engine = createEngine({
      sceneCtx,
      world: physics.world,
      worldStep: physics.step,
      dicePairs,
      onSettled: () => ctrl.onSettled(),
    })

    // 注入 engine（解决循环依赖）
    ctrl.setEngine(engine)

    engine.start()
    setStore(gameStore)
    setController(ctrl)

    return () => {
      engine.dispose()
      disposeSceneResources(sceneCtx.scene)
      sceneCtx.dispose()
      physics.dispose()
      canvasHost.removeChild(canvas)
      setController(null)
      setStore(null)
    }
  }, [])

  return (
    <GameStoreContext.Provider value={store}>
      <GameControllerContext.Provider value={controller}>
        <div
          ref={containerRef}
          className="game-viewport"
        >
          <div className="canvas-host" />
          {controller && children}
        </div>
      </GameControllerContext.Provider>
    </GameStoreContext.Provider>
  )
}
