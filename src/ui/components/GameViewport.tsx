import { useRef, useEffect, useState, type ReactNode } from 'react'
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

interface GameViewportProps {
  children?: ReactNode
}

/**
 * 3D 容器组件
 * 持有 canvas ref，useEffect 中创建/销毁引擎实例（幂等，兼容 StrictMode 双调用）
 * 通过 Provider 包裹 children，确保 overlay 组件能获取 controller
 */
export function GameViewport({ children }: GameViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [controller, setController] = useState<GameController | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 创建 canvas
    const canvas = document.createElement('canvas')
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    container.appendChild(canvas)

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

    // 骰子初始位置（碗上方）
    dicePairs.forEach(({ body }, i) => {
      const angle = (i / dicePairs.length) * Math.PI * 2
      body.position.set(Math.cos(angle) * 0.3, 1.5, Math.sin(angle) * 0.3)
    })

    // 创建 store、engine、controller
    const store = createGameStore()
    const ctrl = new GameController({
      store,
      engine: null!, // 先占位
      dicePairs,
    })

    const engine = createEngine({
      sceneCtx,
      world: physics.world,
      worldStep: physics.step,
      dicePairs,
      onSettled: () => ctrl.onSettled(),
    })

    // 回填 engine 引用
    ;(ctrl as any).engine = engine

    engine.start()
    setController(ctrl)

    return () => {
      engine.dispose()
      sceneCtx.dispose()
      physics.dispose()
      container.removeChild(canvas)
      setController(null)
    }
  }, [])

  return (
    <GameControllerContext.Provider value={controller}>
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: '100vh',
          overflow: 'hidden',
          background: '#1a1a2e',
        }}
      >
        {controller && children}
      </div>
    </GameControllerContext.Provider>
  )
}
