// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { countPrizePool, type GameTimingConfig } from '@dice/game-domain'
import { RoomRepository } from './repository'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeDatabase = describe.skipIf(!databaseUrl)

describeDatabase('PostgreSQL 单房间 repository', () => {
  const roomId = `test-${randomUUID()}`
  const replayRoomId = `test-replay-${randomUUID()}`
  const resetRoomId = `test-reset-${randomUUID()}`
  const pool = new Pool({ connectionString: databaseUrl, max: 4 })
  const repository = new RoomRepository(pool)
  const timing: GameTimingConfig = {
    turnActionTimeoutMs: 30_000,
    tiltDecisionTimeoutMs: 10_000,
    endDecisionTimeoutMs: 30_000,
    maxAutoRetries: 1,
  }

  beforeAll(async () => {
    await repository.ensureOpenRoom(roomId, '集成测试房间')
  })

  afterAll(async () => {
    await pool.query('DELETE FROM rooms WHERE id = ANY($1::text[])', [
      [roomId, replayRoomId, resetRoomId],
    ])
    await pool.end()
  })

  it('第一人成为房主，恢复凭据不创建重复玩家', async () => {
    const alice = await repository.joinRoom({ roomId, displayName: 'Alice', maxPlayers: 12 })
    const resumed = await repository.joinRoom({
      roomId,
      displayName: 'Alice',
      resumeToken: alice.resumeToken,
      maxPlayers: 12,
    })
    expect(resumed).toEqual(alice)

    const snapshot = await repository.getRoomSnapshot(roomId, new Set([alice.playerId]))
    expect(snapshot.hostPlayerId).toBe(alice.playerId)
    expect(snapshot.members).toEqual([
      expect.objectContaining({ id: alice.playerId, role: 'player', seat: 0, connected: true }),
    ])
    expect(countPrizePool(snapshot.prizePool)).toBe(63)
  })

  it('开局前按加入顺序锁定座位，只有房主可启动', async () => {
    const snapshotBefore = await repository.getRoomSnapshot(roomId, new Set())
    const aliceId = snapshotBefore.hostPlayerId!
    const bob = await repository.joinRoom({ roomId, displayName: 'Bob', maxPlayers: 12 })

    await expect(
      repository.startGame({ roomId, playerId: bob.playerId, now: 10_000, timing }),
    ).rejects.toMatchObject({ code: 'forbidden' })

    await repository.startGame({ roomId, playerId: aliceId, now: 10_000, timing })
    const started = await repository.getRoomSnapshot(roomId, new Set([aliceId, bob.playerId]))
    expect(started.phase).toBe('playing')
    expect(started.currentTurn).toMatchObject({
      playerId: aliceId,
      sequence: 1,
      cycleNumber: 1,
      retryCount: 0,
    })
    expect(new Date(started.currentTurn!.deadlineAt).getTime()).toBe(40_000)
    expect(started.members.filter(({ role }) => role === 'player').map(({ seat }) => seat)).toEqual(
      [0, 1],
    )

    await expect(repository.expireDueDeadlines(39_999, timing)).resolves.toEqual([])
    await expect(repository.expireDueDeadlines(40_000, timing)).resolves.toEqual([roomId])
    const advanced = await repository.getRoomSnapshot(roomId, new Set())
    expect(advanced.currentTurn).toMatchObject({ playerId: bob.playerId, sequence: 2 })
  })

  it('开局后新加入者只能旁观', async () => {
    const spectator = await repository.joinRoom({ roomId, displayName: 'Carol', maxPlayers: 12 })
    expect(spectator.role).toBe('spectator')
    const snapshot = await repository.getRoomSnapshot(roomId, new Set([spectator.playerId]))
    expect(snapshot.members.find(({ id }) => id === spectator.playerId)).toMatchObject({
      role: 'spectator',
      seat: null,
      connected: true,
    })
  })

  it('rolling 截止时间揭晓权威结果并原子扣奖，而不是误跳过回合', async () => {
    const before = await repository.getRoomSnapshot(roomId, new Set())
    const currentPlayerId = before.currentTurn!.playerId
    const yixiuBefore = before.prizePool.yixiu
    const roll = await repository.beginAuthoritativeRoll({
      roomId,
      playerId: currentPlayerId,
      commandId: randomUUID(),
      now: 40_001,
      seed: 50_000,
      diceValues: [1, 2, 3, 4, 5, 5],
      settleReason: 'natural-sleep',
      revealAt: 41_000,
      throwAlgorithmVersion: '3',
      settleAlgorithmVersion: '4',
      diagnostics: { seed: 50_000 },
      requiresTiltDecision: false,
    })
    expect(roll.duplicate).toBe(false)
    await expect(repository.expireDueDeadlines(40_999, timing)).resolves.toEqual([])
    await expect(repository.expireDueDeadlines(41_000, timing)).resolves.toEqual([roomId])

    const after = await repository.getRoomSnapshot(roomId, new Set())
    expect(after.prizePool.yixiu).toBe(yixiuBefore - 1)
    expect(after.awardsByPlayer[currentPlayerId].yixiu).toBe(1)
    expect(after.recentRolls[0]).toMatchObject({
      id: roll.rollId,
      playerId: currentPlayerId,
      diceValues: [1, 2, 3, 4, 5, 5],
      awardTier: 'yixiu',
      allocationReason: 'granted',
    })
    expect(after.currentTurn?.playerId).not.toBe(currentPlayerId)
  })

  it('倾斜结果先隔离，当前玩家可在同一回合重投后再结算', async () => {
    const before = await repository.getRoomSnapshot(roomId, new Set())
    const currentPlayerId = before.currentTurn!.playerId
    const first = await repository.beginAuthoritativeRoll({
      roomId,
      playerId: currentPlayerId,
      commandId: randomUUID(),
      now: 41_001,
      seed: 50_001,
      diceValues: [1, 2, 3, 4, 5, 5],
      settleReason: 'pose-stable',
      revealAt: 42_000,
      throwAlgorithmVersion: '3',
      settleAlgorithmVersion: '4',
      diagnostics: { seed: 50_001, ambiguousDiceCount: 1 },
      requiresTiltDecision: true,
    })
    await expect(repository.expireDueDeadlines(42_000, timing)).resolves.toEqual([roomId])
    const awaitingDecision = await repository.getRoomSnapshot(roomId, new Set())
    expect(awaitingDecision.currentTurn).toMatchObject({
      playerId: currentPlayerId,
      status: 'tilt-decision',
    })
    expect(awaitingDecision.recentRolls.some(({ id }) => id === first.rollId)).toBe(false)

    await repository.resolveTiltDecision({
      roomId,
      playerId: currentPlayerId,
      decision: 'retry',
      now: 42_001,
      timing,
    })
    const reopened = await repository.getRoomSnapshot(roomId, new Set())
    expect(reopened.currentTurn).toMatchObject({
      playerId: currentPlayerId,
      status: 'awaiting-roll',
      retryCount: 1,
    })

    const second = await repository.beginAuthoritativeRoll({
      roomId,
      playerId: currentPlayerId,
      commandId: randomUUID(),
      now: 42_002,
      seed: 50_002,
      diceValues: [1, 2, 3, 5, 6, 6],
      settleReason: 'natural-sleep',
      revealAt: 43_000,
      throwAlgorithmVersion: '3',
      settleAlgorithmVersion: '4',
      diagnostics: { seed: 50_002 },
      requiresTiltDecision: false,
    })
    await expect(repository.expireDueDeadlines(43_000, timing)).resolves.toEqual([roomId])
    const committed = await repository.getRoomSnapshot(roomId, new Set())
    expect(committed.recentRolls[0]).toMatchObject({ id: second.rollId })
    expect(committed.recentRolls.some(({ id }) => id === first.rollId)).toBe(false)
  })

  it('倾斜确认倒计时到期后持久化同回合自动重投请求', async () => {
    const before = await repository.getRoomSnapshot(roomId, new Set())
    const currentPlayerId = before.currentTurn!.playerId
    await repository.beginAuthoritativeRoll({
      roomId,
      playerId: currentPlayerId,
      commandId: randomUUID(),
      now: 43_001,
      seed: 50_003,
      diceValues: [1, 2, 3, 4, 5, 5],
      settleReason: 'pose-stable',
      revealAt: 44_000,
      throwAlgorithmVersion: '3',
      settleAlgorithmVersion: '4',
      diagnostics: { seed: 50_003, ambiguousDiceCount: 1 },
      requiresTiltDecision: true,
    })
    await repository.processDueDeadlines(44_000, timing)
    const decision = await repository.getRoomSnapshot(roomId, new Set())
    const decisionDeadline = new Date(decision.currentTurn!.deadlineAt).getTime()
    await expect(repository.processDueDeadlines(decisionDeadline, timing)).resolves.toEqual({
      changedRoomIds: [roomId],
      autoRollRequests: [{ roomId, playerId: currentPlayerId }],
    })
    const retry = await repository.getRoomSnapshot(roomId, new Set())
    expect(retry.currentTurn).toMatchObject({
      playerId: currentPlayerId,
      status: 'awaiting-roll',
      retryCount: 1,
    })
  })

  it('已终止的错误命令重放会返回明确冲突，不读取空揭晓时间', async () => {
    const before = await repository.getRoomSnapshot(roomId, new Set())
    const playerId = before.currentTurn!.playerId
    const commandId = randomUUID()
    await repository.recordAuthoritativeRollError({
      roomId,
      playerId,
      commandId,
      now: 54_001,
      seed: 50_004,
      settleReason: 'timeout',
      errorReason: 'timeout',
      throwAlgorithmVersion: '3',
      settleAlgorithmVersion: '4',
      diagnostics: { seed: 50_004 },
      timing,
    })
    await expect(
      repository.beginAuthoritativeRoll({
        roomId,
        playerId,
        commandId,
        now: 54_002,
        seed: 50_005,
        diceValues: [1, 2, 3, 4, 5, 5],
        settleReason: 'natural-sleep',
        revealAt: 55_000,
        throwAlgorithmVersion: '3',
        settleAlgorithmVersion: '4',
        diagnostics: { seed: 50_005 },
        requiresTiltDecision: false,
      }),
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('本局结束后新加入者保持旁观，原房主可按锁定阵容再开一局', async () => {
    await repository.ensureOpenRoom(replayRoomId, '再开一局测试')
    const host = await repository.joinRoom({
      roomId: replayRoomId,
      displayName: 'ReplayHost',
      maxPlayers: 12,
    })
    const finished = await repository.getRoomSnapshot(replayRoomId, new Set())
    await pool.query(
      "UPDATE games SET status = 'finished', finished_at = now() WHERE id = $1 AND status = 'lobby'",
      [finished.gameId],
    )

    const spectator = await repository.joinRoom({
      roomId: replayRoomId,
      displayName: 'LateGuest',
      maxPlayers: 12,
    })
    expect(spectator.role).toBe('spectator')

    await repository.startGame({
      roomId: replayRoomId,
      playerId: host.playerId,
      now: 60_000,
      timing,
    })
    const restarted = await repository.getRoomSnapshot(replayRoomId, new Set())
    expect(restarted.gameId).not.toBe(finished.gameId)
    expect(restarted.phase).toBe('playing')
    expect(restarted.currentTurn).toMatchObject({ playerId: host.playerId, sequence: 1 })
    expect(countPrizePool(restarted.prizePool)).toBe(63)
    expect(restarted.members.find(({ id }) => id === spectator.playerId)).toMatchObject({
      role: 'spectator',
      seat: null,
    })
  })

  it('强制重置保留房间配置，但删除全部成员、对局和旧恢复凭据', async () => {
    await repository.ensureOpenRoom(resetRoomId, '待重置房间')
    const host = await repository.joinRoom({
      roomId: resetRoomId,
      displayName: 'ResetHost',
      maxPlayers: 12,
    })
    await repository.joinRoom({ roomId: resetRoomId, displayName: 'ResetGuest', maxPlayers: 12 })
    await repository.startGame({
      roomId: resetRoomId,
      playerId: host.playerId,
      now: 70_000,
      timing,
    })

    await expect(repository.forceResetRoom(resetRoomId)).resolves.toEqual({
      roomId: resetRoomId,
      deletedMemberCount: 2,
      deletedGameCount: 1,
    })
    await expect(
      repository.joinRoom({
        roomId: resetRoomId,
        displayName: 'ResetHost',
        resumeToken: host.resumeToken,
        maxPlayers: 12,
      }),
    ).rejects.toMatchObject({ code: 'not-found' })

    const preserved = await pool.query<{
      display_name: string
      access_type: string
      host_member_id: string | null
    }>('SELECT display_name, access_type, host_member_id FROM rooms WHERE id = $1', [resetRoomId])
    expect(preserved.rows[0]).toEqual({
      display_name: '待重置房间',
      access_type: 'open',
      host_member_id: null,
    })

    const replacement = await repository.joinRoom({
      roomId: resetRoomId,
      displayName: 'NewHost',
      maxPlayers: 12,
    })
    const snapshot = await repository.getRoomSnapshot(resetRoomId, new Set())
    expect(snapshot).toMatchObject({
      phase: 'lobby',
      hostPlayerId: replacement.playerId,
      members: [expect.objectContaining({ id: replacement.playerId, seat: 0, role: 'player' })],
    })
    expect(countPrizePool(snapshot.prizePool)).toBe(63)
  })
})
