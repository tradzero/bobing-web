import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { createGameStore } from '@/game/store'
import { GameStoreContext } from '@/ui/components/GameStoreContext'
import { MobileBottomSheet } from '@/ui/components/MobileBottomSheet'
import { Prize } from '@/rules/types'

let store: ReturnType<typeof createGameStore>

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <GameStoreContext.Provider value={store}>
      {children}
    </GameStoreContext.Provider>
  )
}

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

beforeEach(() => {
  store = createGameStore()
  mockMatchMedia(true)

  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: vi.fn(() => true),
  })
})

describe('MobileBottomSheet', () => {
  it('idle 态不渲染结算浮层', () => {
    const { container } = render(
      <MobileBottomSheet>
        <div className="result-panel">结算区</div>
      </MobileBottomSheet>,
      { wrapper: Wrapper },
    )

    expect(container.querySelector('.mobile-sheet')).toBeNull()
  })

  it('result 态渲染并进入 peek，离开结果态后消失', () => {
    const { container } = render(
      <MobileBottomSheet>
        <div className="result-panel">结算区</div>
      </MobileBottomSheet>,
      { wrapper: Wrapper },
    )

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
    expect(container.querySelector('.mobile-sheet')).toHaveAttribute('data-state', 'peek')

    act(() => {
      store.getState().setPhase('idle')
    })
    expect(container.querySelector('.mobile-sheet')).toBeNull()
  })

  it('点击 handle 在 peek / expanded / hidden 之间切换', () => {
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

    const { container } = render(
      <MobileBottomSheet>
        <div className="result-panel">结算区</div>
      </MobileBottomSheet>,
      { wrapper: Wrapper },
    )

    const handle = container.querySelector('.mobile-sheet-handle') as HTMLButtonElement
    const sheet = container.querySelector('.mobile-sheet')

    fireEvent.click(handle)
    expect(sheet).toHaveAttribute('data-state', 'expanded')

    fireEvent.click(handle)
    expect(sheet).toHaveAttribute('data-state', 'hidden')

    fireEvent.click(handle)
    expect(sheet).toHaveAttribute('data-state', 'peek')
  })

  it('下滑手势可将 peek 态收起到 hidden', () => {
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

    const { container } = render(
      <MobileBottomSheet>
        <div className="result-panel">结算区</div>
      </MobileBottomSheet>,
      { wrapper: Wrapper },
    )

    const handle = container.querySelector('.mobile-sheet-handle') as HTMLButtonElement
    const sheet = container.querySelector('.mobile-sheet')

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 200 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 200 })

    expect(sheet).toHaveAttribute('data-state', 'hidden')
  })
})