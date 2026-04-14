import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createGameStore } from '@/game/store'
import { GameStoreContext } from '@/ui/components/GameStoreContext'
import { GameControllerContext } from '@/ui/components/GameControllerContext'
import type { GameController } from '@/game/controller'
import { ThrowButton } from '@/ui/components/ThrowButton'
import { ResetButton } from '@/ui/components/ResetButton'
import { ResultPanel } from '@/ui/components/ResultPanel'
import { History } from '@/ui/components/History'
import { PrizeRecord } from '@/ui/components/PrizeRecord'
import { RoundDisplay } from '@/ui/components/RoundDisplay'
import { SoundToggle } from '@/ui/components/SoundToggle'
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
    const btn = screen.getByTitle('关闭音效')
    expect(btn).toHaveTextContent('🔊')
  })

  it('关闭后显示静音图标和 title', () => {
    act(() => store.getState().toggleSound())
    render(<SoundToggle />, { wrapper: Wrapper })
    const btn = screen.getByTitle('开启音效')
    expect(btn).toHaveTextContent('🔇')
  })

  it('点击调用 controller.toggleSound', async () => {
    render(<SoundToggle />, { wrapper: Wrapper })
    await userEvent.click(screen.getByTitle('关闭音效'))
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
