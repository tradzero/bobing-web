import { beforeEach, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { RollSeedBridge } from '@/multiplayer/RollSeedBridge'

const playback = vi.hoisted(() => ({ phase: 'rolling', throwAuthoritative: vi.fn() }))
vi.mock('@/ui/components/GameControllerContext', () => ({ useGameController: () => playback }))
vi.mock('@/ui/components/GameStoreContext', () => ({
  useGameStore: (select: (state: { phase: string }) => string) => select(playback),
}))
beforeEach(() => {
  playback.phase = 'rolling'
  playback.throwAuthoritative.mockReset()
})

it('前次动画忙碌拒绝新 seed 后，状态改变会重试且成功后不重复播放', () => {
  playback.throwAuthoritative.mockReturnValueOnce(false).mockReturnValue(true)
  const activeRoll = {
    id: 'next',
    playerId: 'player',
    seed: 42,
    revealAt: '2026-09-05T00:00:00.000Z',
    throwAlgorithmVersion: '3',
    settleAlgorithmVersion: '4',
  }
  const view = render(<RollSeedBridge activeRoll={activeRoll} />)
  expect(playback.throwAuthoritative).toHaveBeenCalledOnce()
  playback.phase = 'result'
  view.rerender(<RollSeedBridge activeRoll={activeRoll} />)
  expect(playback.throwAuthoritative).toHaveBeenCalledTimes(2)
  playback.phase = 'rolling'
  view.rerender(<RollSeedBridge activeRoll={activeRoll} />)
  expect(playback.throwAuthoritative).toHaveBeenCalledTimes(2)
})
