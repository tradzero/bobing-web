import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createGameStore } from '@/game/store'
import { GameController } from '@/game/controller'
import { GameStoreContext } from '@/ui/components/GameStoreContext'
import { GameControllerContext } from '@/ui/components/GameControllerContext'
import { ThrowButton } from '@/ui/components/ThrowButton'
import { ResetButton } from '@/ui/components/ResetButton'
import { ResultPanel } from '@/ui/components/ResultPanel'
import { History } from '@/ui/components/History'
import { PrizeRecord } from '@/ui/components/PrizeRecord'
import { RoundDisplay } from '@/ui/components/RoundDisplay'
import { SoundToggle } from '@/ui/components/SoundToggle'
import { TiltWarning } from '@/ui/components/TiltWarning'
import { GameOverlay } from '@/App'
import { Prize } from '@/rules/types'
import type { ReactNode } from 'react'

/**
 * 阶段 2 UI 组件集成测试
 * 使用真实 createGameStore + 两个 Provider，只 mock controller 方法
 * 覆盖各组件在 idle / rolling / result 三态下的行为
 */

let store: ReturnType<typeof createGameStore>
let mockCtrl: {
  throw: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
  toggleSound: ReturnType<typeof vi.fn>
  onSettled: ReturnType<typeof vi.fn>
  setEngine: ReturnType<typeof vi.fn>
  acceptTilted: ReturnType<typeof vi.fn>
  rethrow: ReturnType<typeof vi.fn>
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <GameStoreContext.Provider value={store}>
      <GameControllerContext.Provider value={mockCtrl as unknown as GameController}>
        {children}
      </GameControllerContext.Provider>
    </GameStoreContext.Provider>
  )
}

beforeEach(() => {
  store = createGameStore()
  mockCtrl = {
    throw: vi.fn(),
    reset: vi.fn(),
    toggleSound: vi.fn(),
    onSettled: vi.fn(),
    setEngine: vi.fn(),
    acceptTilted: vi.fn(),
    rethrow: vi.fn(),
  }
})

// ── ThrowButton ──
describe('ThrowButton', () => {
  it('idle 态显示"掷骰"且可点击', async () => {
    render(<ThrowButton />, { wrapper: Wrapper })
    const btn = screen.getByRole('button', { name: '掷骰' })
    expect(btn).not.toBeDisabled()
    await userEvent.click(btn)
    expect(mockCtrl.throw).toHaveBeenCalledOnce()
  })

  it('rolling 态显示"骰子翻滚中"且禁用', () => {
    act(() => store.getState().setPhase('rolling'))
    render(<ThrowButton />, { wrapper: Wrapper })
    const btn = screen.getByRole('button', { name: '骰子翻滚中' })
    expect(btn).toBeDisabled()
  })

  it('result 态显示"掷骰"且可点击', () => {
    act(() => store.getState().setPhase('result'))
    render(<ThrowButton />, { wrapper: Wrapper })
    const btn = screen.getByRole('button', { name: '掷骰' })
    expect(btn).not.toBeDisabled()
  })
})

// ── ResetButton ──
describe('ResetButton', () => {
  it('idle 态可点击', async () => {
    render(<ResetButton />, { wrapper: Wrapper })
    const btn = screen.getByTitle('重置游戏')
    expect(btn).not.toBeDisabled()
    await userEvent.click(btn)
    expect(mockCtrl.reset).toHaveBeenCalledOnce()
  })

  it('rolling 态禁用', () => {
    act(() => store.getState().setPhase('rolling'))
    render(<ResetButton />, { wrapper: Wrapper })
    expect(screen.getByTitle('重置游戏')).toBeDisabled()
  })

  it('result 态可点击', () => {
    act(() => store.getState().setPhase('result'))
    render(<ResetButton />, { wrapper: Wrapper })
    expect(screen.getByTitle('重置游戏')).not.toBeDisabled()
  })
})

// ── ResultPanel ──
describe('ResultPanel', () => {
  it('idle 态不渲染', () => {
    const { container } = render(<ResultPanel />, { wrapper: Wrapper })
    expect(container.querySelector('.result-panel')).toBeNull()
  })

  it('rolling 态不渲染', () => {
    act(() => store.getState().setPhase('rolling'))
    const { container } = render(<ResultPanel />, { wrapper: Wrapper })
    expect(container.querySelector('.result-panel')).toBeNull()
  })

  it('result 态显示奖级和点数', () => {
    act(() => {
      store.getState().setResult({
        diceValues: [4, 4, 4, 4, 2, 3],
        result: {
          prize: Prize.ZhuangYuan,
          priority: 7,
          carryScore: 5,
          matchedDice: [4, 4, 4, 4],
          remainDice: [2, 3],
          description: '状元 带5',
        },
      })
    })
    render(<ResultPanel />, { wrapper: Wrapper })
    expect(screen.getByText('状元')).toBeInTheDocument()
    expect(screen.getByText('带5')).toBeInTheDocument()
    // 6 个骰子点数
    const pips = document.querySelectorAll('.dice-pip')
    expect(pips).toHaveLength(6)
    // 四点应有 red class
    const redPips = document.querySelectorAll('.dice-pip.red')
    expect(redPips.length).toBe(4)
  })

  it('未中奖时显示"未中奖"', () => {
    act(() => {
      store.getState().setResult({
        diceValues: [1, 2, 3, 5, 5, 6],
        result: {
          prize: Prize.None,
          priority: 13,
          carryScore: 0,
          matchedDice: [],
          remainDice: [1, 2, 3, 5, 5, 6],
          description: '未中奖',
        },
      })
    })
    render(<ResultPanel />, { wrapper: Wrapper })
    expect(screen.getByText('未中奖')).toBeInTheDocument()
    expect(document.querySelector('.result-prize.no-prize')).toBeInTheDocument()
  })
})

// ── RoundDisplay ──
describe('RoundDisplay', () => {
  it('显示初始轮次', () => {
    render(<RoundDisplay />, { wrapper: Wrapper })
    expect(screen.getByText('第 1 轮')).toBeInTheDocument()
  })

  it('setResult 后轮次递增', () => {
    act(() => {
      store.getState().setResult({
        diceValues: [4, 1, 2, 3, 5, 6],
        result: {
          prize: Prize.YiXiu,
          priority: 12,
          carryScore: 17,
          matchedDice: [4],
          remainDice: [1, 2, 3, 5, 6],
          description: '一秀 带17',
        },
      })
    })
    render(<RoundDisplay />, { wrapper: Wrapper })
    expect(screen.getByText('第 2 轮')).toBeInTheDocument()
  })
})

// ── SoundToggle ──
describe('SoundToggle', () => {
  it('默认显示开启图标和 title', () => {
    render(<SoundToggle />, { wrapper: Wrapper })
    const btn = screen.getByRole('button', { name: '关闭音效' })
    expect(btn.querySelector('.btn-icon-glyph-sound.is-on')).not.toBeNull()
  })

  it('关闭后显示静音图标和 title', () => {
    act(() => store.getState().toggleSound())
    render(<SoundToggle />, { wrapper: Wrapper })
    const btn = screen.getByRole('button', { name: '开启音效' })
    expect(btn.querySelector('.btn-icon-glyph-sound.is-off')).not.toBeNull()
  })

  it('点击调用 controller.toggleSound', async () => {
    render(<SoundToggle />, { wrapper: Wrapper })
    await userEvent.click(screen.getByRole('button', { name: '关闭音效' }))
    expect(mockCtrl.toggleSound).toHaveBeenCalledOnce()
  })
})

// ── History ──
describe('History', () => {
  it('空态不渲染', () => {
    const { container } = render(<History />, { wrapper: Wrapper })
    expect(container.querySelector('.panel-card')).toBeNull()
  })

  it('setResult 后渲染历史条目', () => {
    act(() => {
      store.getState().setResult({
        diceValues: [4, 4, 4, 1, 2, 3],
        result: {
          prize: Prize.SanHong,
          priority: 9,
          carryScore: 6,
          matchedDice: [4, 4, 4],
          remainDice: [1, 2, 3],
          description: '三红 带6',
        },
      })
    })
    render(<History />, { wrapper: Wrapper })
    expect(screen.getByText('历史记录')).toBeInTheDocument()
    expect(screen.getByText('第1轮')).toBeInTheDocument()
    expect(screen.getByText('三红')).toBeInTheDocument()
  })
})

describe('GameOverlay', () => {
  it('初始态显示内容区提示边且不渲染侧栏', () => {
    const { container } = render(<GameOverlay />, { wrapper: Wrapper })

    expect(screen.getByText('记录区将在此展开')).toBeInTheDocument()
    expect(container.querySelector('.side-panel')).toBeNull()
  })

  it('首轮结算后隐藏提示边并渲染侧栏', () => {
    act(() => {
      store.getState().setResult({
        diceValues: [4, 1, 2, 3, 5, 6],
        result: {
          prize: Prize.YiXiu,
          priority: 12,
          carryScore: 17,
          matchedDice: [4],
          remainDice: [1, 2, 3, 5, 6],
          description: '一秀 带17',
        },
      })
    })

    const { container } = render(<GameOverlay />, { wrapper: Wrapper })

    expect(screen.queryByText('记录区将在此展开')).toBeNull()
    expect(container.querySelector('.side-panel')).not.toBeNull()
  })
})

// ── PrizeRecord ──
describe('PrizeRecord', () => {
  it('空态不渲染', () => {
    const { container } = render(<PrizeRecord />, { wrapper: Wrapper })
    expect(container.querySelector('.panel-card')).toBeNull()
  })

  it('setResult 后渲染奖级统计', () => {
    act(() => {
      store.getState().setResult({
        diceValues: [4, 4, 4, 4, 2, 3],
        result: {
          prize: Prize.ZhuangYuan,
          priority: 7,
          carryScore: 5,
          matchedDice: [4, 4, 4, 4],
          remainDice: [2, 3],
          description: '状元 带5',
        },
      })
    })
    render(<PrizeRecord />, { wrapper: Wrapper })
    expect(screen.getByText('奖级统计')).toBeInTheDocument()
    expect(screen.getByText('状元')).toBeInTheDocument()
    expect(screen.getByText('×1')).toBeInTheDocument()
  })
})

// ── TiltWarning ──
const tiltPendingPayload = {
  diceValues: [1, 3, 1, 1, 1, 1],
  result: {
    prize: Prize.YiXiu,
    priority: 12,
    carryScore: 7,
    matchedDice: [1],
    remainDice: [3, 1, 1, 1, 1],
    description: '一秀 带7',
  },
  tiltedIndices: [1, 4],
}

describe('TiltWarning', () => {
  it('idle 态不渲染', () => {
    const { container } = render(<TiltWarning />, { wrapper: Wrapper })
    expect(container.querySelector('.tilt-warning')).toBeNull()
  })

  it('rolling 态不渲染', () => {
    act(() => store.getState().setPhase('rolling'))
    const { container } = render(<TiltWarning />, { wrapper: Wrapper })
    expect(container.querySelector('.tilt-warning')).toBeNull()
  })

  it('tilt-confirm 态渲染倾斜提示文本', () => {
    act(() => store.getState().setPending(tiltPendingPayload))
    render(<TiltWarning />, { wrapper: Wrapper })
    expect(screen.getByText(/第2颗.*第5颗.*倾斜/)).toBeInTheDocument()
  })

  it('"接受结果" 按钮调用 controller.acceptTilted', async () => {
    act(() => store.getState().setPending(tiltPendingPayload))
    render(<TiltWarning />, { wrapper: Wrapper })
    await userEvent.click(screen.getByRole('button', { name: '接受结果' }))
    expect(mockCtrl.acceptTilted).toHaveBeenCalledOnce()
  })

  it('"重掷" 按钮调用 controller.rethrow', async () => {
    act(() => store.getState().setPending(tiltPendingPayload))
    render(<TiltWarning />, { wrapper: Wrapper })
    await userEvent.click(screen.getByRole('button', { name: '重掷' }))
    expect(mockCtrl.rethrow).toHaveBeenCalledOnce()
  })
})

// ── tilt-confirm 态下其他组件行为 ──
describe('tilt-confirm 态组件联动', () => {
  beforeEach(() => {
    act(() => store.getState().setPending(tiltPendingPayload))
  })

  it('ThrowButton 禁用', () => {
    render(<ThrowButton />, { wrapper: Wrapper })
    expect(screen.getByRole('button', { name: '掷骰' })).toBeDisabled()
  })

  it('ResultPanel 不渲染', () => {
    const { container } = render(<ResultPanel />, { wrapper: Wrapper })
    expect(container.querySelector('.result-panel')).toBeNull()
  })

  it('ResetButton 可点击', async () => {
    render(<ResetButton />, { wrapper: Wrapper })
    const btn = screen.getByTitle('重置游戏')
    expect(btn).not.toBeDisabled()
    await userEvent.click(btn)
    expect(mockCtrl.reset).toHaveBeenCalledOnce()
  })
})

// ── TiltWarning 真实 controller + 真实 store 集成测试 ──
describe('TiltWarning 真实接线', () => {
  it('"接受结果" 点击后 store.phase 变为 result', async () => {
    const realStore = createGameStore()
    // 通过 store 直接设置 tilt-confirm 态（不需要物理层）
    act(() =>
      realStore.getState().setPending({
        diceValues: [4, 1, 2, 3, 5, 6],
        result: {
          prize: Prize.YiXiu,
          priority: 12,
          carryScore: 17,
          matchedDice: [4],
          remainDice: [1, 2, 3, 5, 6],
          description: '一秀 带17',
        },
        tiltedIndices: [0],
      }),
    )
    // 真实 controller，acceptTilted 调用 store.commitPending
    const realCtrl = new GameController({ store: realStore, dicePairs: [] })

    render(
      <GameStoreContext.Provider value={realStore}>
        <GameControllerContext.Provider value={realCtrl}>
          <TiltWarning />
        </GameControllerContext.Provider>
      </GameStoreContext.Provider>,
    )

    await userEvent.click(screen.getByRole('button', { name: '接受结果' }))
    expect(realStore.getState().phase).toBe('result')
    expect(realStore.getState().history.length).toBe(1)
    expect(realStore.getState().pendingSettlement).toBeNull()
  })

  it('"重掷" 点击后 store.phase 变为 rolling', async () => {
    const realStore = createGameStore()
    act(() =>
      realStore.getState().setPending({
        diceValues: [4, 1, 2, 3, 5, 6],
        result: {
          prize: Prize.YiXiu,
          priority: 12,
          carryScore: 17,
          matchedDice: [4],
          remainDice: [1, 2, 3, 5, 6],
          description: '一秀 带17',
        },
        tiltedIndices: [0],
      }),
    )
    const mockEngine = {
      start: vi.fn(),
      stop: vi.fn(),
      dispose: vi.fn(),
      beginSettle: vi.fn(),
    }
    const realCtrl = new GameController({ store: realStore, dicePairs: [] })
    realCtrl.setEngine(mockEngine)

    render(
      <GameStoreContext.Provider value={realStore}>
        <GameControllerContext.Provider value={realCtrl}>
          <TiltWarning />
        </GameControllerContext.Provider>
      </GameStoreContext.Provider>,
    )

    await userEvent.click(screen.getByRole('button', { name: '重掷' }))
    expect(realStore.getState().phase).toBe('rolling')
    expect(realStore.getState().pendingSettlement).toBeNull()
    expect(mockEngine.beginSettle).toHaveBeenCalledOnce()
  })
})
