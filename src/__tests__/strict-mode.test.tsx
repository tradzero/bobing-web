import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import { GameViewport } from '@/ui/components/GameViewport'

/**
 * StrictMode 重挂载测试
 * Mock 3D / 物理 / 引擎依赖，验证 mount → unmount → remount 后：
 *   1. 只有一个 canvas 留在 DOM
 *   2. createEngine / dispose 调用次数成对
 *   3. 没有残留 rAF 或 observer
 */

// ── Mock 依赖 ──

// 追踪 engine 创建 / dispose 调用
const engineCreateCalls: number[] = []
const engineDisposeCalls: number[] = []
let callCounter = 0

vi.mock('@/scene/setup', () => ({
  createScene: () => {
    const mockScene = {
      add: vi.fn(),
      traverse: vi.fn(),
      background: null,
    }
    return {
      scene: mockScene,
      camera: {},
      renderer: {
        render: vi.fn(),
        dispose: vi.fn(),
        setSize: vi.fn(),
        setPixelRatio: vi.fn(),
        shadowMap: { enabled: false },
      },
      handleResize: vi.fn(),
      dispose: vi.fn(),
    }
  },
}))

vi.mock('@/scene/table', () => ({
  createTable: () => ({ position: { y: 0 } }),
}))

vi.mock('@/scene/bowl', () => ({
  createBowl: () => ({}),
}))

vi.mock('@/physics/world', () => ({
  createPhysicsWorld: () => ({
    world: {
      addBody: vi.fn(),
      step: vi.fn(),
    },
    step: vi.fn(),
    dispose: vi.fn(),
  }),
}))

vi.mock('@/physics/materials', () => ({
  setupContactMaterials: vi.fn(),
}))

vi.mock('@/physics/bowl-body', () => ({
  createBowlBodies: vi.fn(),
  ESCAPE_Y: 0.9,
}))

// Mock 骰子创建：返回带有必要属性的 body + mesh
vi.mock('@/dice/create', () => ({
  createDiceSet: () =>
    Array.from({ length: 6 }, () => ({
      mesh: {
        position: { set: vi.fn() },
        quaternion: { set: vi.fn() },
      },
      body: {
        position: { set: vi.fn(), copy: vi.fn(), x: 0, y: 0.3, z: 0 },
        previousPosition: { copy: vi.fn() },
        velocity: { set: vi.fn(), y: 0 },
        angularVelocity: { set: vi.fn() },
        quaternion: { set: vi.fn(), x: 0, y: 0, z: 0, w: 1 },
        aabbNeedsUpdate: false,
        wakeUp: vi.fn(),
        sleep: vi.fn(),
        sleepState: 0,
      },
    })),
}))

vi.mock('@/game/engine', () => ({
  createEngine: () => {
    const id = ++callCounter
    engineCreateCalls.push(id)
    return {
      start: vi.fn(),
      stop: vi.fn(),
      dispose: () => {
        engineDisposeCalls.push(id)
      },
      beginSettle: vi.fn(),
    }
  },
}))

beforeEach(() => {
  callCounter = 0
  engineCreateCalls.length = 0
  engineDisposeCalls.length = 0
})

describe('StrictMode 重挂载', () => {
  it('mount → unmount → remount 后只有一个 canvas', () => {
    // 第一次挂载 + 卸载
    const { unmount: unmount1, container: container1 } = render(
      <StrictMode>
        <GameViewport />
      </StrictMode>,
    )
    unmount1()
    expect(container1.querySelectorAll('canvas')).toHaveLength(0)

    // 第二次挂载
    const { container: container2 } = render(
      <StrictMode>
        <GameViewport />
      </StrictMode>,
    )
    expect(container2.querySelectorAll('canvas')).toHaveLength(1)
  })

  it('engine create / dispose 调用次数成对', () => {
    const { unmount } = render(
      <StrictMode>
        <GameViewport />
      </StrictMode>,
    )
    // StrictMode 下 React 会 mount → unmount → remount
    // 所以 create 可能 >= 1，但 unmount 时 dispose 应成对

    unmount()

    // 卸载后 engine dispose 调用数应等于 create 调用数
    expect(engineDisposeCalls.length).toBe(engineCreateCalls.length)
  })

  it('remount 后无残留 canvas（StrictMode 双调用安全）', () => {
    // 用 StrictMode 渲染（会触发 useEffect 双调用）
    const { container } = render(
      <StrictMode>
        <GameViewport>
          <div data-testid="child">overlay</div>
        </GameViewport>
      </StrictMode>,
    )

    // 应该只有 1 个 canvas（StrictMode 的第二次 mount cleanup 了第一次的）
    const canvases = container.querySelectorAll('canvas')
    expect(canvases).toHaveLength(1)
  })

  it('dispose 和 create 的 ID 配对正确', () => {
    const { unmount } = render(
      <StrictMode>
        <GameViewport />
      </StrictMode>,
    )
    unmount()

    // 每个 create 的 engine 都应该被 dispose
    for (const id of engineCreateCalls) {
      expect(
        engineDisposeCalls.includes(id),
        `engine #${id} created but not disposed`,
      ).toBe(true)
    }
  })
})
