// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { countPrizePool, type GameTimingConfig } from '@dice/game-domain'
import { RoomRepository } from './repository'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeDatabase = describe.skipIf(!databaseUrl)

describeDatabase('PostgreSQL 房间 repository', () => {
  const roomId = `test-${randomUUID()}`
  const replayRoomId = `test-replay-${randomUUID()}`
  const resetRoomId = `test-reset-${randomUUID()}`
  const emptyLifecycleRoomId = `test-empty-lifecycle-${randomUUID()}`
  const permanentDefaultRoomId = `test-default-lifecycle-${randomUUID()}`
  const createdRoomIds: string[] = []
  const pool = new Pool({ connectionString: databaseUrl, max: 4 })
  const repository = new RoomRepository(pool)
  const timing: GameTimingConfig = {
    turnActionTimeoutMs: 30_000,
    tiltDecisionTimeoutMs: 10_000,
    endDecisionTimeoutMs: 30_000,
    maxAutoRetries: 1,
  }
  const lifecycle = {
    emptyRoomTtlMs: 3_600_000,
    gameIdleAbandonMs: 1_800_000,
    roomIdleArchiveMs: 86_400_000,
    archivedRoomRetentionMs: 604_800_000,
  }

  beforeAll(async () => {
    await repository.ensureOpenRoom(roomId, '集成测试房间')
  })

  afterAll(async () => {
    await pool.query('DELETE FROM rooms WHERE id = ANY($1::text[])', [
      [
        roomId,
        replayRoomId,
        resetRoomId,
        emptyLifecycleRoomId,
        permanentDefaultRoomId,
        ...createdRoomIds,
      ],
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

  it('创建并列出多个开放房，同名玩家与游戏状态按房间隔离', async () => {
    const [moonRoom, seaRoom] = await Promise.all([
      repository.createRoomWithHost({
        displayName: ' 海上生明月 ',
        creatorDisplayName: '同名玩家',
      }),
      repository.createRoomWithHost({
        displayName: '天涯共此时',
        creatorDisplayName: '同名玩家',
      }),
    ])
    createdRoomIds.push(moonRoom.room.id, seaRoom.room.id)
    expect(moonRoom.room).toMatchObject({
      displayName: '海上生明月',
      accessType: 'open',
      phase: 'lobby',
      playerCount: 1,
      spectatorCount: 0,
    })
    expect(moonRoom.playerId).toBeTruthy()
    expect(moonRoom.resumeToken).toBeTruthy()

    expect(moonRoom.playerId).not.toBe(seaRoom.playerId)

    await repository.startGame({
      roomId: moonRoom.room.id,
      playerId: moonRoom.playerId,
      now: 100_000,
      timing,
    })
    const [moonSnapshot, seaSnapshot] = await Promise.all([
      repository.getRoomSnapshot(moonRoom.room.id, new Set()),
      repository.getRoomSnapshot(seaRoom.room.id, new Set()),
    ])
    expect(moonSnapshot).toMatchObject({ roomId: moonRoom.room.id, phase: 'playing' })
    expect(seaSnapshot).toMatchObject({ roomId: seaRoom.room.id, phase: 'lobby' })
    expect(moonSnapshot.gameId).not.toBe(seaSnapshot.gameId)

    const directory = await repository.listRooms()
    expect(directory.find(({ id }) => id === moonRoom.room.id)).toMatchObject({
      phase: 'playing',
      playerCount: 1,
    })
    expect(directory.find(({ id }) => id === seaRoom.room.id)).toMatchObject({
      phase: 'lobby',
      playerCount: 1,
    })
  })

  it('密码房只保存 scrypt 哈希，新成员必须验证密码，恢复令牌可直接认证', async () => {
    const password = 'moon-cake-2026'
    const created = await repository.createRoomWithHost({
      displayName: '密码房测试',
      creatorDisplayName: 'PasswordHost',
      password,
    })
    createdRoomIds.push(created.room.id)
    expect(created.room.accessType).toBe('password')

    const stored = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM rooms WHERE id = $1',
      [created.room.id],
    )
    expect(stored.rows[0]?.password_hash).toMatch(/^scrypt-v1\$/)
    expect(stored.rows[0]?.password_hash).not.toContain(password)
    expect((await repository.listRooms()).find(({ id }) => id === created.room.id)).toMatchObject({
      accessType: 'password',
    })

    await expect(
      repository.joinRoom({
        roomId: created.room.id,
        displayName: 'PasswordGuest',
        maxPlayers: 12,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      repository.joinRoom({
        roomId: created.room.id,
        displayName: 'PasswordGuest',
        password: 'wrong-password',
        maxPlayers: 12,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })

    const guest = await repository.joinRoom({
      roomId: created.room.id,
      displayName: 'PasswordGuest',
      password,
      maxPlayers: 12,
    })
    await expect(
      repository.joinRoom({
        roomId: created.room.id,
        displayName: 'PasswordGuest',
        resumeToken: guest.resumeToken,
        maxPlayers: 12,
      }),
    ).resolves.toMatchObject({ playerId: guest.playerId })
  })

  it('只有已认证房主能关闭非默认房，进行中游戏会先进入废弃终态', async () => {
    const now = Date.now()
    const created = await repository.createRoomWithHost({
      displayName: '主动关闭测试',
      creatorDisplayName: 'CloseHost',
      now,
    })
    createdRoomIds.push(created.room.id)
    const guest = await repository.joinRoom({
      roomId: created.room.id,
      displayName: 'CloseGuest',
      maxPlayers: 12,
    })
    await repository.startGame({
      roomId: created.room.id,
      playerId: created.playerId,
      now: now + 1,
      timing,
    })

    await expect(
      repository.closeRoom({
        roomId: created.room.id,
        playerId: guest.playerId,
        defaultRoomId: permanentDefaultRoomId,
        now: now + 2,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      repository.closeRoom({
        roomId: created.room.id,
        playerId: created.playerId,
        defaultRoomId: created.room.id,
        now: now + 2,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })

    await repository.closeRoom({
      roomId: created.room.id,
      playerId: created.playerId,
      defaultRoomId: permanentDefaultRoomId,
      now: now + 3,
    })
    await expect(repository.getRoomSnapshot(created.room.id, new Set())).rejects.toMatchObject({
      code: 'not-found',
    })
    expect((await repository.listRooms()).some(({ id }) => id === created.room.id)).toBe(false)
    const closed = await pool.query<{ archived_at: Date; status: string; skip_reason: string }>(
      `
        SELECT r.archived_at, g.status, t.skip_reason
        FROM rooms r
        JOIN games g ON g.room_id = r.id
        JOIN turns t ON t.game_id = g.id
        WHERE r.id = $1
      `,
      [created.room.id],
    )
    expect(closed.rows).toEqual([
      expect.objectContaining({ status: 'abandoned', skip_reason: 'room-abandoned' }),
    ])
    expect(closed.rows[0]?.archived_at.getTime()).toBe(now + 3)
  })

  it('并发重放同一投掷命令只创建一个权威结果', async () => {
    const created = await repository.createRoomWithHost({
      displayName: '幂等命令房间',
      creatorDisplayName: 'IdempotentHost',
    })
    const room = created.room
    const host = created
    createdRoomIds.push(room.id)
    await repository.startGame({
      roomId: room.id,
      playerId: host.playerId,
      now: 200_000,
      timing,
    })
    const commandId = randomUUID()
    const request = {
      roomId: room.id,
      playerId: host.playerId,
      commandId,
      now: 200_001,
      seed: 51_000,
      diceValues: [1, 2, 3, 4, 5, 5],
      settleReason: 'natural-sleep',
      revealAt: 201_000,
      throwAlgorithmVersion: '3',
      settleAlgorithmVersion: '4',
      diagnostics: { seed: 51_000 },
      requiresTiltDecision: false,
    }
    expect(await repository.prepareAuthoritativeRoll(request)).toBeNull()
    await expect(
      repository.prepareAuthoritativeRoll({ ...request, playerId: randomUUID() }),
    ).rejects.toThrow('还没有轮到')
    await expect(repository.prepareAuthoritativeRoll({ ...request, now: 999_999 })).rejects.toThrow(
      '已超时',
    )
    const results = await Promise.all([
      repository.beginAuthoritativeRoll(request),
      repository.beginAuthoritativeRoll({ ...request, seed: 51_001 }),
    ])

    expect(new Set(results.map(({ rollId }) => rollId)).size).toBe(1)
    expect(await repository.prepareAuthoritativeRoll(request)).toMatchObject({
      rollId: results[0].rollId,
      duplicate: true,
    })
    await expect(
      repository.prepareAuthoritativeRoll({ ...request, playerId: randomUUID() }),
    ).rejects.toThrow('不属于当前玩家')
    const winningSeeds = results.map(({ seed }) => seed)
    expect(new Set(winningSeeds).size).toBe(1)
    expect([51_000, 51_001]).toContain(winningSeeds[0])
    expect(results.map(({ duplicate }) => duplicate).sort()).toEqual([false, true])
    const count = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM roll_attempts WHERE game_id = $1 AND command_id = $2',
      [(await repository.getRoomSnapshot(room.id, new Set())).gameId, commandId],
    )
    expect(count.rows[0]?.count).toBe('1')
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

    await expect(repository.processDueDeadlines(39_999, timing)).resolves.toMatchObject({
      changedRoomIds: [],
    })
    await expect(repository.processDueDeadlines(40_000, timing)).resolves.toMatchObject({
      changedRoomIds: [roomId],
    })
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
    await expect(repository.processDueDeadlines(40_999, timing)).resolves.toMatchObject({
      changedRoomIds: [],
    })
    await expect(repository.processDueDeadlines(41_000, timing)).resolves.toMatchObject({
      changedRoomIds: [roomId],
    })

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
    await expect(repository.processDueDeadlines(42_000, timing)).resolves.toMatchObject({
      changedRoomIds: [roomId],
    })
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
    await expect(repository.processDueDeadlines(43_000, timing)).resolves.toMatchObject({
      changedRoomIds: [roomId],
    })
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

  it('进行中对局长期无真实操作时明确废弃，并停止 deadline 自循环', async () => {
    const created = await repository.createRoomWithHost({
      displayName: '废弃对局测试',
      creatorDisplayName: 'IdleHost',
      now: 0,
    })
    createdRoomIds.push(created.room.id)
    await repository.startGame({
      roomId: created.room.id,
      playerId: created.playerId,
      now: 1_000,
      timing,
    })
    const sameThresholdLifecycle = {
      ...lifecycle,
      roomIdleArchiveMs: lifecycle.gameIdleAbandonMs,
    }

    await expect(
      repository.processRoomLifecycle(1_800_999, sameThresholdLifecycle, permanentDefaultRoomId),
    ).resolves.toMatchObject({ abandonedRoomIds: [] })
    const lifecycleSweep = await repository.processRoomLifecycle(
      1_801_000,
      sameThresholdLifecycle,
      permanentDefaultRoomId,
    )
    expect(lifecycleSweep.abandonedRoomIds).toEqual([created.room.id])
    expect(lifecycleSweep.archivedRoomIds).not.toContain(created.room.id)

    const abandoned = await repository.getRoomSnapshot(created.room.id, new Set())
    expect(abandoned).toMatchObject({ phase: 'abandoned', currentTurn: null })
    const stoppedTurn = await pool.query<{ status: string; skip_reason: string }>(
      `
        SELECT t.status, t.skip_reason
        FROM turns t
        JOIN games g ON g.id = t.game_id
        WHERE g.id = $1
      `,
      [abandoned.gameId],
    )
    expect(stoppedTurn.rows).toEqual([{ status: 'skipped', skip_reason: 'room-abandoned' }])
    const deadlineSweep = await repository.processDueDeadlines(9_999_999, timing)
    expect(deadlineSweep.changedRoomIds).not.toContain(created.room.id)

    await repository.startGame({
      roomId: created.room.id,
      playerId: created.playerId,
      now: 1_801_001,
      timing,
    })
    const restarted = await repository.getRoomSnapshot(created.room.id, new Set())
    expect(restarted).toMatchObject({ phase: 'playing' })
    expect(restarted.gameId).not.toBe(abandoned.gameId)
  })

  it('空房过期删除、闲置房归档后延迟删除，默认房间始终保留', async () => {
    await repository.ensureOpenRoom(emptyLifecycleRoomId, '空房清理测试')
    await repository.ensureOpenRoom(permanentDefaultRoomId, '永久默认房')
    await pool.query(
      `
        UPDATE rooms
        SET created_at = to_timestamp(0),
            last_activity_at = to_timestamp(0)
        WHERE id = ANY($1::text[])
      `,
      [[emptyLifecycleRoomId, permanentDefaultRoomId]],
    )
    const emptySweep = await repository.processRoomLifecycle(
      lifecycle.emptyRoomTtlMs,
      lifecycle,
      permanentDefaultRoomId,
    )
    expect(emptySweep.deletedRoomIds).toContain(emptyLifecycleRoomId)
    expect(emptySweep.deletedRoomIds).not.toContain(permanentDefaultRoomId)

    const idle = await repository.createRoomWithHost({
      displayName: '归档测试',
      creatorDisplayName: 'ArchiveHost',
      now: 0,
    })
    createdRoomIds.push(idle.room.id)
    await repository.recordPresence(idle.room.id, idle.playerId, 23 * 60 * 60_000)
    const stillPresent = await repository.processRoomLifecycle(
      24 * 60 * 60_000,
      lifecycle,
      permanentDefaultRoomId,
    )
    expect(stillPresent.archivedRoomIds).not.toContain(idle.room.id)

    const archivedAt = 47 * 60 * 60_000
    const archived = await repository.processRoomLifecycle(
      archivedAt,
      lifecycle,
      permanentDefaultRoomId,
    )
    expect(archived.archivedRoomIds).toContain(idle.room.id)
    await expect(repository.getRoomSnapshot(idle.room.id, new Set())).rejects.toMatchObject({
      code: 'not-found',
    })
    expect((await repository.listRooms()).some(({ id }) => id === idle.room.id)).toBe(false)

    const deleted = await repository.processRoomLifecycle(
      archivedAt + lifecycle.archivedRoomRetentionMs,
      lifecycle,
      permanentDefaultRoomId,
    )
    expect(deleted.deletedRoomIds).toContain(idle.room.id)
    const remaining = await pool.query<{ archived_at: Date | null }>(
      'SELECT archived_at FROM rooms WHERE id = $1',
      [permanentDefaultRoomId],
    )
    expect(remaining.rows).toEqual([{ archived_at: null }])
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
