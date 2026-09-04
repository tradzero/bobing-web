// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  GamePhase,
  abandonMultiplayerGame,
  chooseGameEndMode,
  createMultiplayerGame,
  expireEndDecision,
  getPlayerAwardCounts,
  recordAuthoritativeRoll,
  skipActiveTurn,
  startMultiplayerGame,
  type GameTimingConfig,
  type MultiplayerGameState,
} from '..'

const timing: GameTimingConfig = {
  turnActionTimeoutMs: 30_000,
  tiltDecisionTimeoutMs: 10_000,
  endDecisionTimeoutMs: 30_000,
  maxAutoRetries: 1,
}

function lobby() {
  return createMultiplayerGame({
    id: 'game-1',
    roomId: 'default',
    hostPlayerId: 'a',
    players: [
      { id: 'a', displayName: 'Alice', seat: 0 },
      { id: 'b', displayName: 'Bob', seat: 1 },
      { id: 'c', displayName: 'Carol', seat: 2 },
    ],
  })
}

function playing(): MultiplayerGameState {
  return startMultiplayerGame(lobby(), { now: 1_000, turnId: 'turn-1', timing })
}

function roll(
  state: MultiplayerGameState,
  playerId: string,
  diceValues: number[],
  sequence: number,
) {
  return recordAuthoritativeRoll(state, {
    playerId,
    diceValues,
    rollId: `roll-${sequence}`,
    nextTurnId: `turn-${sequence + 1}`,
    grantId: `grant-${sequence}`,
    now: 1_000 + sequence * 100,
    timing,
  })
}

describe('多人游戏聚合状态', () => {
  it('启动后按座位建立 30 秒权威回合', () => {
    const state = playing()
    expect(state.phase).toBe(GamePhase.Playing)
    expect(state.activeTurn).toMatchObject({
      id: 'turn-1',
      playerId: 'a',
      sequence: 1,
      cycleNumber: 1,
      deadlineAt: 31_000,
    })
  })

  it('只允许当前玩家提交，正常结算后推进下一座', () => {
    const state = playing()
    expect(() => roll(state, 'b', [1, 2, 3, 4, 5, 5], 1)).toThrow(
      /current|current|current|only|\u5f53前/,
    )

    const settled = roll(state, 'a', [1, 2, 3, 4, 5, 5], 1)
    expect(settled.activeTurn?.playerId).toBe('b')
    expect(settled.prizePool.yixiu).toBe(31)
    expect(getPlayerAwardCounts(settled, 'a').yixiu).toBe(1)
  })

  it('重复 rollId 不能造成二次扣奖', () => {
    const first = roll(playing(), 'a', [1, 2, 3, 4, 5, 5], 1)
    expect(() =>
      recordAuthoritativeRoll(first, {
        playerId: 'b',
        diceValues: [1, 2, 3, 4, 5, 5],
        rollId: 'roll-1',
        nextTurnId: 'turn-3',
        grantId: 'grant-2',
        now: 1_300,
        timing,
      }),
    ).toThrow(/ID/)
    expect(first.prizePool.yixiu).toBe(31)
  })

  it('回合超时会留下原因并自动跳到下一人', () => {
    const state = playing()
    expect(() =>
      skipActiveTurn(state, {
        now: 30_999,
        nextTurnId: 'turn-2',
        reason: 'turn-timeout',
        timing,
      }),
    ).toThrow(/\u5c1a未超时/)

    const skipped = skipActiveTurn(state, {
      now: 31_000,
      nextTurnId: 'turn-2',
      reason: 'turn-timeout',
      timing,
    })
    expect(skipped.activeTurn?.playerId).toBe('b')
    expect(skipped.turnSkips).toEqual([
      expect.objectContaining({ playerId: 'a', reason: 'turn-timeout' }),
    ])
  })

  it('长期无人操作会废弃对局并终止当前回合，不再创建下一回合', () => {
    const state = playing()
    const abandoned = abandonMultiplayerGame(state, 40_000)
    expect(abandoned).toMatchObject({
      phase: GamePhase.Abandoned,
      activeTurn: null,
      abandonedAt: 40_000,
      endDecisionDeadlineAt: null,
      bonusQueue: [],
    })
    expect(abandoned.nextTurnSequence).toBe(state.nextTurnSequence)
    expect(abandoned.turnSkips).toEqual([
      expect.objectContaining({
        turnId: 'turn-1',
        playerId: 'a',
        reason: 'room-abandoned',
      }),
    ])
    expect(() => abandonMultiplayerGame(lobby(), 40_000)).toThrow(/进行中/)
  })

  it('最后一份奖领完后进入有截止时间的结束选择', () => {
    const state: MultiplayerGameState = {
      ...playing(),
      prizePool: { zhuangyuan: 0, duitang: 0, sanhong: 0, sijin: 0, erju: 0, yixiu: 1 },
      zhuangyuanClaims: {
        a: {
          playerId: 'a',
          rollId: 'prior-zhuangyuan',
          sequence: 1,
          diceValues: [4, 4, 4, 4, 2, 6],
          result: {
            prize: 'zhuangyuan',
            priority: 7,
            carryScore: 8,
            matchedDice: [4, 4, 4, 4],
            remainDice: [2, 6],
            description: '状元 带8',
          },
        },
      },
      zhuangyuanHolder: {
        playerId: 'a',
        rollId: 'prior-zhuangyuan',
        sequence: 1,
        diceValues: [4, 4, 4, 4, 2, 6],
        result: {
          prize: 'zhuangyuan',
          priority: 7,
          carryScore: 8,
          matchedDice: [4, 4, 4, 4],
          remainDice: [2, 6],
          description: '状元 带8',
        },
      },
    }

    const completed = roll(state, 'a', [1, 2, 3, 4, 5, 5], 2)
    expect(completed.phase).toBe(GamePhase.EndDecision)
    expect(completed.activeTurn).toBeNull()
    expect(completed.poolCompletedByPlayerId).toBe('a')
    expect(completed.endDecisionDeadlineAt).toBe(31_200)
  })

  it('加赛队列每人恰好一次，普通结果不再产生奖品', () => {
    const decision: MultiplayerGameState = {
      ...playing(),
      phase: GamePhase.EndDecision,
      activeTurn: null,
      prizePool: { zhuangyuan: 0, duitang: 0, sanhong: 0, sijin: 0, erju: 0, yixiu: 0 },
      poolCompletedByPlayerId: 'b',
      endDecisionDeadlineAt: 40_000,
    }
    let state = chooseGameEndMode(decision, {
      mode: 'bonus-round',
      now: 10_000,
      turnId: 'bonus-1',
      timing,
    })
    expect(state.bonusQueue).toEqual(['c', 'a', 'b'])

    state = roll(state, 'c', [1, 2, 3, 4, 5, 5], 1)
    state = roll(state, 'a', [1, 2, 3, 4, 5, 5], 2)
    state = roll(state, 'b', [1, 2, 3, 4, 5, 5], 3)
    expect(state.phase).toBe(GamePhase.Finished)
    expect(state.awardGrants).toHaveLength(0)
    expect(state.bonusQueue).toEqual([])
  })

  it('房主结束选择超时时默认立即结束', () => {
    const state: MultiplayerGameState = {
      ...playing(),
      phase: GamePhase.EndDecision,
      activeTurn: null,
      poolCompletedByPlayerId: 'a',
      endDecisionDeadlineAt: 9_000,
    }
    expect(() => expireEndDecision(state, 8_999)).toThrow(/\u5c1a未超时/)
    expect(expireEndDecision(state, 9_000)).toMatchObject({
      phase: GamePhase.Finished,
      finishedAt: 9_000,
    })
  })
})
