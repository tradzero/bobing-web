import { beforeEach, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { judge } from '@dice/game-domain'
import { MULTIPLAYER_PROTOCOL_VERSION, type RoomSnapshot } from '@dice/protocol'
import { createGameStore } from '@/game/store'
import type { GameController } from '@/game/controller'
import { GameStoreContext } from '@/ui/components/GameStoreContext'
import { GameControllerContext } from '@/ui/components/GameControllerContext'
import { RoomResultAnnouncement } from '@/multiplayer/RoomResultAnnouncement'
import type { MultiplayerRoomState } from '@/multiplayer/use-room'

let store: ReturnType<typeof createGameStore>
const controller = { throwAuthoritative: vi.fn() }
const diceValues = [4, 4, 4, 1, 2, 3]
const roll = {
  id: 'roll-1',
  playerId: 'alice',
  diceValues,
  result: judge(diceValues),
  awardTier: null,
  allocationReason: 'granted',
  createdAt: '2026-09-05T00:00:00Z',
}

function roomState(): MultiplayerRoomState {
  const snapshot: RoomSnapshot = {
    protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
    roomId: 'room',
    roomDisplayName: '中秋一桌',
    gameId: 'game',
    phase: 'playing',
    revision: 1,
    serverTime: '2026-09-05T00:00:00Z',
    hostPlayerId: 'alice',
    members: [{ id: 'alice', displayName: '阿明', seat: 0, role: 'player', connected: true }],
    currentTurn: null,
    activeRoll: null,
    prizePool: { zhuangyuan: 1, duitang: 2, sanhong: 4, sijin: 8, erju: 16, yixiu: 32 },
    awardsByPlayer: {},
    zhuangyuan: null,
    recentRolls: [],
    endDecisionDeadlineAt: null,
  }
  return {
    status: 'joined',
    playerId: 'alice',
    snapshot,
    activeRoll: {
      id: roll.id,
      playerId: 'alice',
      seed: 42,
      revealAt: '2026-09-05T00:00:02Z',
      throwAlgorithmVersion: '3',
      settleAlgorithmVersion: '4',
    },
    error: null,
    pendingCommand: null,
  }
}

function view(state: MultiplayerRoomState) {
  return (
    <GameStoreContext.Provider value={store}>
      <GameControllerContext.Provider value={controller as unknown as GameController}>
        <RoomResultAnnouncement state={state} />
      </GameControllerContext.Provider>
    </GameStoreContext.Provider>
  )
}

beforeEach(() => {
  store = createGameStore()
  controller.throwAuthoritative.mockReset().mockImplementation(() => {
    store.getState().setPhase('rolling')
    return true
  })
})

it('权威结果先到时等待动画停稳，使用权威点数；心跳不重新播放揭晓', () => {
  const state = roomState()
  const rendered = render(view(state))
  state.activeRoll = null
  state.snapshot!.recentRolls = [roll]
  rendered.rerender(view(state))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  // 本地结果刻意与服务端不同，播报不得拿本地判奖替代权威记录。
  act(() =>
    store
      .getState()
      .setResult({ diceValues: [1, 2, 3, 5, 5, 6], result: judge([1, 2, 3, 5, 5, 6]) }),
  )
  const announcement = screen.getByRole('status')
  expect(announcement).toHaveTextContent('阿明博得三红带6')
  expect(announcement.querySelectorAll('[aria-label="骰子点数 4"]')).toHaveLength(3)
  state.snapshot = { ...state.snapshot!, revision: 2 }
  rendered.rerender(view(state))
  expect(screen.getByRole('status')).toBe(announcement)
  expect(controller.throwAuthoritative).toHaveBeenCalledOnce()
  state.pendingCommand = 'request-roll'
  rendered.rerender(view(state))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('本机先停稳时等待服务端提交；倾斜确认前和异常不报喜', () => {
  const state = roomState()
  const rendered = render(view(state))
  act(() => store.getState().setPhase('tilt-confirm'))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  state.activeRoll = null
  state.snapshot!.recentRolls = [{ ...roll, allocationReason: 'out-of-stock' }]
  rendered.rerender(view(state))
  expect(screen.getByRole('status')).toHaveTextContent('这份奖已博完')
  act(() => store.getState().setPhase('error'))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('刷新后的历史记录不冒充刚刚播放的结果；新一投拒绝沿用旧播报', () => {
  const state = roomState()
  const activeRoll = state.activeRoll!
  state.activeRoll = null
  state.snapshot!.recentRolls = [roll]
  const rendered = render(view(state))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  state.activeRoll = activeRoll
  rendered.rerender(view(state))
  state.activeRoll = null
  act(() => store.getState().setPhase('result'))
  rendered.rerender(view(state))
  expect(screen.getByRole('status')).toHaveTextContent('阿明')
  controller.throwAuthoritative.mockReturnValue(false)
  state.activeRoll = { ...activeRoll, id: 'roll-2', seed: 50_000 }
  rendered.rerender(view(state))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
