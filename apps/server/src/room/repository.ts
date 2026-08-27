import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Pool, PoolClient, QueryResultRow } from 'pg'
import {
  AwardTier,
  GamePhase,
  INITIAL_PRIZE_POOL,
  chooseGameEndMode,
  createMultiplayerGame,
  expireEndDecision,
  getPlayerAwardCounts,
  judge,
  recordAuthoritativeRoll,
  selectZhuangyuanHolder,
  skipActiveTurn,
  startMultiplayerGame,
  type ActiveTurn,
  type AwardGrant,
  type GamePhase as GamePhaseType,
  type GamePlayer,
  type GameTimingConfig,
  type JudgeResult,
  type MultiplayerGameState,
  type RollRecord,
  type TurnSkipRecord,
  type ZhuangyuanClaim,
} from '@dice/game-domain'
import { MULTIPLAYER_PROTOCOL_VERSION, type RoomSnapshot } from '@dice/protocol'

interface RoomRow extends QueryResultRow {
  id: string
  host_member_id: string | null
}

interface MemberRow extends QueryResultRow {
  id: string
  display_name: string
  seat: number | null
  member_role: 'player' | 'spectator'
}

interface GameRow extends QueryResultRow {
  id: string
  room_id: string
  host_player_id: string
  status: string
  version: string
  next_turn_sequence: number
  pool_completed_by_player_id: string | null
  end_decision_deadline_at: Date | null
  bonus_queue: string[]
  started_at: Date | null
  finished_at: Date | null
}

interface PlayerRow extends QueryResultRow {
  player_id: string
  display_name: string
  seat: number
}

interface PoolRow extends QueryResultRow {
  tier: AwardTier
  remaining_count: number
}

interface TurnRow extends QueryResultRow {
  id: string
  sequence: number
  cycle_number: number
  player_id: string
  status: 'awaiting-roll' | 'rolling' | 'tilt-decision' | 'completed' | 'skipped'
  deadline_at: Date
  retry_count: number
  skip_reason: TurnSkipRecord['reason'] | null
  created_at: Date
}

interface RollRow extends QueryResultRow {
  id: string
  roll_sequence: number
  player_id: string
  dice_values: number[]
  judge_result: JudgeResult
  award_tier: AwardTier | null
  allocation_reason: RollRecord['allocationReason']
  created_at: Date
}

interface ComputedRollRow extends QueryResultRow {
  id: string
  turn_id: string
  player_id: string
  seed: string
  status: 'computed' | 'awaiting-tilt' | 'committed' | 'rejected' | 'error'
  dice_values: number[] | null
  judge_result: JudgeResult | null
  diagnostics: Record<string, unknown>
  reveal_at: Date | null
  throw_algorithm_version: string
  settle_algorithm_version: string
  requires_tilt_decision: boolean
}

interface GrantRow extends QueryResultRow {
  id: string
  roll_id: string
  player_id: string
  tier: AwardGrant['tier']
  grant_sequence: number
}

interface ClaimRow extends QueryResultRow {
  player_id: string
  roll_id: string
  claim_sequence: number
  dice_values: number[]
  judge_result: JudgeResult
}

export class RoomRepositoryError extends Error {
  readonly code: 'not-found' | 'conflict' | 'forbidden' | 'room-full'

  constructor(code: RoomRepositoryError['code'], message: string) {
    super(message)
    this.name = 'RoomRepositoryError'
    this.code = code
  }
}

export interface JoinedMember {
  playerId: string
  resumeToken: string
  role: 'player' | 'spectator'
}

export interface ComputedRollInput {
  roomId: string
  playerId: string
  commandId: string
  now: number
  seed: number
  diceValues: number[]
  settleReason: string
  revealAt: number
  throwAlgorithmVersion: string
  settleAlgorithmVersion: string
  diagnostics: Record<string, unknown>
  requiresTiltDecision: boolean
}

export interface StartedRoll {
  rollId: string
  seed: number
  revealAt: number
  playerId: string
  throwAlgorithmVersion: string
  settleAlgorithmVersion: string
  duplicate: boolean
}

export interface RollErrorInput {
  roomId: string
  playerId: string
  commandId: string
  now: number
  seed: number
  settleReason: string
  errorReason: string
  throwAlgorithmVersion: string
  settleAlgorithmVersion: string
  diagnostics: Record<string, unknown>
  timing: GameTimingConfig
}

export interface RollErrorResult {
  shouldAutoRetry: boolean
}

export interface TiltDecisionInput {
  roomId: string
  playerId: string
  decision: 'accept' | 'retry'
  now: number
  timing: GameTimingConfig
}

export interface AutoRollRequest {
  roomId: string
  playerId: string
}

export interface DeadlineSweepResult {
  changedRoomIds: string[]
  autoRollRequests: AutoRollRequest[]
}

function normalizedName(displayName: string): { displayName: string; normalized: string } {
  const trimmed = displayName.trim()
  if (trimmed.length < 1 || trimmed.length > 24) {
    throw new RangeError('昵称长度必须在 1..24 之间')
  }
  return { displayName: trimmed, normalized: trimmed.toLocaleLowerCase() }
}

function hashResumeToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function parsePhase(value: string): GamePhaseType {
  if (Object.values(GamePhase).includes(value as GamePhaseType)) return value as GamePhaseType
  throw new Error(`数据库中存在未知游戏阶段 ${value}`)
}

function numberVersion(value: string): number {
  const version = Number(value)
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('游戏版本超出安全整数范围')
  return version
}

function requireRollDiceValues(roll: ComputedRollRow): number[] {
  if (!roll.dice_values) throw new Error(`投掷 ${roll.id} 缺少可提交的六骰结果`)
  return roll.dice_values
}

function requireRollRevealAt(roll: ComputedRollRow): Date {
  if (!roll.reveal_at) throw new Error(`投掷 ${roll.id} 缺少揭晓时间`)
  return roll.reveal_at
}

export class RoomRepository {
  private readonly pool: Pool

  constructor(pool: Pool) {
    this.pool = pool
  }

  async ensureOpenRoom(roomId: string, displayName = '中秋博饼'): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO rooms (id, display_name, access_type)
        VALUES ($1, $2, 'open')
        ON CONFLICT (id) DO NOTHING
      `,
      [roomId, displayName],
    )
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1')
  }

  async joinRoom(input: {
    roomId: string
    displayName: string
    resumeToken?: string
    maxPlayers: number
  }): Promise<JoinedMember> {
    const name = normalizedName(input.displayName)
    return this.withTransaction(async (client) => {
      const roomResult = await client.query<RoomRow>(
        'SELECT id, host_member_id FROM rooms WHERE id = $1 FOR UPDATE',
        [input.roomId],
      )
      const room = roomResult.rows[0]
      if (!room) throw new RoomRepositoryError('not-found', '房间不存在')

      if (input.resumeToken) {
        const resumed = await client.query<MemberRow>(
          `
            UPDATE room_members
            SET last_seen_at = now()
            WHERE room_id = $1 AND resume_token_hash = $2 AND retired_at IS NULL
            RETURNING id, display_name, seat, member_role
          `,
          [input.roomId, hashResumeToken(input.resumeToken)],
        )
        const member = resumed.rows[0]
        if (!member) throw new RoomRepositoryError('not-found', '恢复凭据无效或已失效')
        return { playerId: member.id, resumeToken: input.resumeToken, role: member.member_role }
      }

      const latestGameResult = await client.query<GameRow>(
        `
          SELECT * FROM games
          WHERE room_id = $1
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE
        `,
        [input.roomId],
      )
      const latestGame = latestGameResult.rows[0]
      const activeGame =
        latestGame && latestGame.status !== GamePhase.Finished ? latestGame : undefined
      const playerCountResult = activeGame
        ? await client.query<{ count: string }>(
            'SELECT count(*)::text AS count FROM game_players WHERE game_id = $1',
            [activeGame.id],
          )
        : { rows: [{ count: '0' }] }
      const playerCount = Number(playerCountResult.rows[0]?.count ?? 0)
      const joinsAsPlayer =
        (!latestGame || latestGame.status === GamePhase.Lobby) && playerCount < input.maxPlayers
      const role: JoinedMember['role'] = joinsAsPlayer ? 'player' : 'spectator'
      const nextSeatResult = joinsAsPlayer
        ? await client.query<{ next_seat: number }>(
            `
              SELECT COALESCE(max(seat), -1) + 1 AS next_seat
              FROM room_members
              WHERE room_id = $1 AND seat IS NOT NULL AND retired_at IS NULL
            `,
            [input.roomId],
          )
        : { rows: [{ next_seat: 0 }] }
      const seat = joinsAsPlayer ? nextSeatResult.rows[0]?.next_seat : null
      const playerId = randomUUID()
      const resumeToken = randomBytes(32).toString('base64url')

      try {
        await client.query(
          `
            INSERT INTO room_members (
              id, room_id, display_name, normalized_name, resume_token_hash, seat, member_role
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            playerId,
            input.roomId,
            name.displayName,
            name.normalized,
            hashResumeToken(resumeToken),
            seat,
            role,
          ],
        )
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new RoomRepositoryError('conflict', '昵称或座位已被占用')
        }
        throw error
      }

      const hostPlayerId = room.host_member_id ?? playerId
      if (!room.host_member_id) {
        await client.query(
          'UPDATE rooms SET host_member_id = $2, updated_at = now() WHERE id = $1',
          [input.roomId, playerId],
        )
      }

      if (joinsAsPlayer) {
        if (!latestGame) {
          await this.insertLobbyGame(client, {
            roomId: input.roomId,
            hostPlayerId,
            players: [{ id: playerId, displayName: name.displayName, seat: seat as number }],
          })
        } else {
          await client.query(
            `
              INSERT INTO game_players (game_id, player_id, display_name, seat)
              VALUES ($1, $2, $3, $4)
            `,
            [latestGame.id, playerId, name.displayName, seat],
          )
        }
      }

      return { playerId, resumeToken, role }
    })
  }

  async startGame(input: {
    roomId: string
    playerId: string
    now: number
    timing: GameTimingConfig
  }): Promise<MultiplayerGameState> {
    return this.withTransaction(async (client) => {
      const before = await this.loadActiveGame(client, input.roomId, true)
      if (before.hostPlayerId !== input.playerId) {
        throw new RoomRepositoryError('forbidden', '只有房主可以开始游戏')
      }
      const lobby =
        before.phase === GamePhase.Finished
          ? await this.insertLobbyGame(client, {
              roomId: before.roomId,
              hostPlayerId: before.hostPlayerId,
              players: before.players,
            })
          : before
      const after = startMultiplayerGame(lobby, {
        now: input.now,
        turnId: randomUUID(),
        timing: input.timing,
      })
      await this.persistStateTransition(client, lobby, after, 'game-started')
      return after
    })
  }

  async beginAuthoritativeRoll(input: ComputedRollInput): Promise<StartedRoll> {
    return this.withTransaction(async (client) => {
      const state = await this.loadActiveGame(client, input.roomId, true)
      if (
        (state.phase !== GamePhase.Playing && state.phase !== GamePhase.BonusRound) ||
        !state.activeTurn
      ) {
        throw new RoomRepositoryError('conflict', '当前房间不接受投掷')
      }

      const existingResult = await client.query<ComputedRollRow>(
        `
          SELECT id, turn_id, player_id, seed, status, dice_values, judge_result, diagnostics,
                 reveal_at, throw_algorithm_version, settle_algorithm_version,
                 requires_tilt_decision
          FROM roll_attempts
          WHERE game_id = $1 AND command_id = $2
        `,
        [state.id, input.commandId],
      )
      const existing = existingResult.rows[0]
      if (existing) {
        if (existing.player_id !== input.playerId) {
          throw new RoomRepositoryError('forbidden', '幂等命令不属于当前玩家')
        }
        if (
          existing.status === 'error' ||
          existing.status === 'rejected' ||
          existing.reveal_at === null
        ) {
          throw new RoomRepositoryError('conflict', '该投掷命令已经终止，请以最新房间状态为准')
        }
        return {
          rollId: existing.id,
          seed: Number(existing.seed),
          revealAt: existing.reveal_at.getTime(),
          playerId: existing.player_id,
          throwAlgorithmVersion: existing.throw_algorithm_version,
          settleAlgorithmVersion: existing.settle_algorithm_version,
          duplicate: true,
        }
      }

      if (state.activeTurn.playerId !== input.playerId) {
        throw new RoomRepositoryError('forbidden', '还没有轮到当前玩家')
      }
      const turnResult = await client.query<TurnRow>(
        'SELECT * FROM turns WHERE id = $1 FOR UPDATE',
        [state.activeTurn.id],
      )
      const turn = turnResult.rows[0]
      if (!turn || turn.status !== 'awaiting-roll') {
        throw new RoomRepositoryError('conflict', '当前回合已经开始投掷')
      }
      if (input.now >= turn.deadline_at.getTime()) {
        throw new RoomRepositoryError('conflict', '当前回合已超时')
      }

      const rollId = randomUUID()
      const result = judge(input.diceValues)
      await client.query(
        `
          INSERT INTO roll_attempts (
            id, game_id, turn_id, player_id, command_id, attempt_number, seed,
            throw_algorithm_version, settle_algorithm_version, status, dice_values,
            judge_result, diagnostics, settle_reason, reveal_at, requires_tilt_decision
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, 'computed', $10, $11::jsonb,
            $12::jsonb, $13, $14, $15
          )
        `,
        [
          rollId,
          state.id,
          turn.id,
          input.playerId,
          input.commandId,
          turn.retry_count + 1,
          input.seed,
          input.throwAlgorithmVersion,
          input.settleAlgorithmVersion,
          input.diceValues,
          JSON.stringify(result),
          JSON.stringify(input.diagnostics),
          input.settleReason,
          new Date(input.revealAt),
          input.requiresTiltDecision,
        ],
      )
      await client.query(
        `
          UPDATE turns
          SET status = 'rolling', deadline_at = $2
          WHERE id = $1
        `,
        [turn.id, new Date(input.revealAt)],
      )
      const nextVersion = state.version + 1
      const updated = await client.query(
        'UPDATE games SET version = $3, updated_at = now() WHERE id = $1 AND version = $2',
        [state.id, state.version, nextVersion],
      )
      if (updated.rowCount !== 1) {
        throw new RoomRepositoryError('conflict', '游戏状态已被其他命令更新')
      }
      await client.query(
        `
          INSERT INTO game_events (game_id, revision, event_type, payload)
          VALUES ($1, $2, 'roll-started', $3::jsonb)
        `,
        [state.id, nextVersion, JSON.stringify({ rollId, playerId: input.playerId })],
      )
      return {
        rollId,
        seed: input.seed,
        revealAt: input.revealAt,
        playerId: input.playerId,
        throwAlgorithmVersion: input.throwAlgorithmVersion,
        settleAlgorithmVersion: input.settleAlgorithmVersion,
        duplicate: false,
      }
    })
  }

  async recordAuthoritativeRollError(input: RollErrorInput): Promise<RollErrorResult> {
    return this.withTransaction(async (client) => {
      const before = await this.loadActiveGame(client, input.roomId, true)
      if (
        (before.phase !== GamePhase.Playing && before.phase !== GamePhase.BonusRound) ||
        !before.activeTurn ||
        before.activeTurn.playerId !== input.playerId
      ) {
        throw new RoomRepositoryError('conflict', '当前回合不接受投掷错误')
      }
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM roll_attempts WHERE game_id = $1 AND command_id = $2',
        [before.id, input.commandId],
      )
      if (existing.rows[0]) return { shouldAutoRetry: false }

      const turnResult = await client.query<TurnRow>(
        'SELECT * FROM turns WHERE id = $1 FOR UPDATE',
        [before.activeTurn.id],
      )
      const turn = turnResult.rows[0]
      if (!turn || turn.status !== 'awaiting-roll') {
        throw new RoomRepositoryError('conflict', '当前回合已经开始投掷')
      }
      await client.query(
        `
          INSERT INTO roll_attempts (
            id, game_id, turn_id, player_id, command_id, attempt_number, seed,
            throw_algorithm_version, settle_algorithm_version, status, diagnostics,
            settle_reason
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'error', $10::jsonb, $11)
        `,
        [
          randomUUID(),
          before.id,
          turn.id,
          input.playerId,
          input.commandId,
          turn.retry_count + 1,
          input.seed,
          input.throwAlgorithmVersion,
          input.settleAlgorithmVersion,
          JSON.stringify({ ...input.diagnostics, authorityError: input.errorReason }),
          input.settleReason,
        ],
      )

      if (turn.retry_count < input.timing.maxAutoRetries) {
        await client.query(
          'UPDATE turns SET retry_count = retry_count + 1, deadline_at = $2 WHERE id = $1',
          [turn.id, new Date(input.now + input.timing.turnActionTimeoutMs)],
        )
        await this.bumpSameTurnRevision(client, before, 'roll-error-retry', {
          playerId: input.playerId,
          errorReason: input.errorReason,
        })
        return { shouldAutoRetry: true }
      }

      const after = skipActiveTurn(before, {
        now: input.now,
        nextTurnId: randomUUID(),
        reason: 'roll-error-limit',
        timing: input.timing,
      })
      await this.persistStateTransition(client, before, after, 'roll-error-limit')
      return { shouldAutoRetry: false }
    })
  }

  async resolveTiltDecision(input: TiltDecisionInput): Promise<void> {
    await this.withTransaction(async (client) => {
      const before = await this.loadActiveGame(client, input.roomId, true)
      if (
        (before.phase !== GamePhase.Playing && before.phase !== GamePhase.BonusRound) ||
        !before.activeTurn
      ) {
        throw new RoomRepositoryError('conflict', '当前没有待确认的倾斜结果')
      }
      if (before.activeTurn.playerId !== input.playerId) {
        throw new RoomRepositoryError('forbidden', '只有当前回合玩家可以确认结果')
      }
      const turnResult = await client.query<TurnRow>(
        'SELECT * FROM turns WHERE id = $1 FOR UPDATE',
        [before.activeTurn.id],
      )
      const turn = turnResult.rows[0]
      if (!turn || turn.status !== 'tilt-decision') {
        throw new RoomRepositoryError('conflict', '当前没有待确认的倾斜结果')
      }
      const rollResult = await client.query<ComputedRollRow>(
        `
          SELECT id, turn_id, player_id, seed, status, dice_values, judge_result, diagnostics,
                 reveal_at, throw_algorithm_version, settle_algorithm_version,
                 requires_tilt_decision
          FROM roll_attempts
          WHERE turn_id = $1 AND status = 'awaiting-tilt'
          ORDER BY attempt_number DESC
          LIMIT 1
          FOR UPDATE
        `,
        [turn.id],
      )
      const roll = rollResult.rows[0]
      if (!roll) throw new RoomRepositoryError('conflict', '倾斜结果已经处理')

      if (input.decision === 'retry') {
        await this.reopenTurnForRetry(
          client,
          before,
          turn,
          roll.id,
          input.now,
          input.timing,
          'manual',
        )
        return
      }

      const after = recordAuthoritativeRoll(before, {
        playerId: input.playerId,
        rollId: roll.id,
        diceValues: requireRollDiceValues(roll),
        now: input.now,
        nextTurnId: randomUUID(),
        grantId: randomUUID(),
        timing: input.timing,
      })
      await this.persistRollTransition(client, before, after, roll.id, 'tilt-result-accepted')
    })
  }

  async chooseEndMode(input: {
    roomId: string
    playerId: string
    mode: 'immediate' | 'bonus-round'
    now: number
    timing: GameTimingConfig
  }): Promise<void> {
    await this.withTransaction(async (client) => {
      const before = await this.loadActiveGame(client, input.roomId, true)
      if (before.hostPlayerId !== input.playerId) {
        throw new RoomRepositoryError('forbidden', '只有房主可以选择结束方式')
      }
      const after = chooseGameEndMode(before, {
        mode: input.mode,
        now: input.now,
        turnId: randomUUID(),
        timing: input.timing,
      })
      await this.persistStateTransition(client, before, after, 'end-mode-chosen')
    })
  }

  /**
   * 绝对截止时间由 PostgreSQL 保存；调度器只负责唤醒。
   * 每个房间都会在事务内重新加锁和校验，重复 tick 不会跳过两次。
   */
  async expireDueDeadlines(now: number, timing: GameTimingConfig): Promise<string[]> {
    return (await this.processDueDeadlines(now, timing)).changedRoomIds
  }

  async processDueDeadlines(now: number, timing: GameTimingConfig): Promise<DeadlineSweepResult> {
    const dueResult = await this.pool.query<{ room_id: string }>(
      `
        SELECT DISTINCT g.room_id
        FROM games g
        LEFT JOIN turns t
          ON t.game_id = g.id AND t.status IN ('awaiting-roll', 'rolling', 'tilt-decision')
        WHERE
          (g.status IN ('playing', 'bonus-round') AND t.deadline_at <= $1)
          OR (g.status = 'end-decision' AND g.end_decision_deadline_at <= $1)
        ORDER BY g.room_id
      `,
      [new Date(now)],
    )
    const changedRooms: string[] = []
    const autoRollRequests: AutoRollRequest[] = []
    for (const { room_id: roomId } of dueResult.rows) {
      const outcome = await this.withTransaction<false | { autoRetryPlayerId?: string }>(
        async (client) => {
          const before = await this.loadActiveGame(client, roomId, true)
          if (
            before.phase === GamePhase.EndDecision &&
            before.endDecisionDeadlineAt !== null &&
            before.endDecisionDeadlineAt <= now
          ) {
            const after = expireEndDecision(before, now)
            await this.persistStateTransition(client, before, after, 'end-decision-timeout')
            return {}
          }
          if (
            (before.phase === GamePhase.Playing || before.phase === GamePhase.BonusRound) &&
            before.activeTurn &&
            before.activeTurn.deadlineAt <= now
          ) {
            const turnResult = await client.query<TurnRow>(
              'SELECT * FROM turns WHERE id = $1 FOR UPDATE',
              [before.activeTurn.id],
            )
            const turn = turnResult.rows[0]
            if (!turn || turn.deadline_at.getTime() > now) return false

            if (turn.status === 'rolling') {
              const rollResult = await client.query<ComputedRollRow>(
                `
                SELECT id, turn_id, player_id, seed, status, dice_values, judge_result, diagnostics,
                       reveal_at, throw_algorithm_version, settle_algorithm_version,
                       requires_tilt_decision
                FROM roll_attempts
                WHERE turn_id = $1 AND status = 'computed' AND reveal_at <= $2
                ORDER BY attempt_number DESC
                LIMIT 1
                FOR UPDATE
              `,
                [turn.id, new Date(now)],
              )
              const roll = rollResult.rows[0]
              if (!roll) return false
              if (roll.requires_tilt_decision) {
                await client.query(
                  "UPDATE roll_attempts SET status = 'awaiting-tilt' WHERE id = $1",
                  [roll.id],
                )
                await client.query(
                  "UPDATE turns SET status = 'tilt-decision', deadline_at = $2 WHERE id = $1",
                  [turn.id, new Date(now + timing.tiltDecisionTimeoutMs)],
                )
                await this.bumpSameTurnRevision(client, before, 'tilt-decision-required', {
                  rollId: roll.id,
                  playerId: roll.player_id,
                })
                return {}
              }

              const after = recordAuthoritativeRoll(before, {
                playerId: roll.player_id,
                rollId: roll.id,
                diceValues: requireRollDiceValues(roll),
                now,
                nextTurnId: randomUUID(),
                grantId: randomUUID(),
                timing,
              })
              await this.persistRollTransition(client, before, after, roll.id, 'roll-committed')
              return {}
            }

            if (turn.status === 'tilt-decision') {
              const rollResult = await client.query<{ id: string }>(
                `
                SELECT id FROM roll_attempts
                WHERE turn_id = $1 AND status = 'awaiting-tilt'
                ORDER BY attempt_number DESC
                LIMIT 1
                FOR UPDATE
              `,
                [turn.id],
              )
              const roll = rollResult.rows[0]
              if (roll && turn.retry_count < timing.maxAutoRetries) {
                await this.reopenTurnForRetry(client, before, turn, roll.id, now, timing, 'timeout')
                return { autoRetryPlayerId: turn.player_id }
              }
              if (roll) {
                await client.query("UPDATE roll_attempts SET status = 'rejected' WHERE id = $1", [
                  roll.id,
                ])
              }
            }

            const after = skipActiveTurn(before, {
              now,
              nextTurnId: randomUUID(),
              reason: 'turn-timeout',
              timing,
            })
            await this.persistStateTransition(client, before, after, 'turn-timeout')
            return {}
          }
          return false
        },
      )
      if (outcome) {
        changedRooms.push(roomId)
        if (outcome.autoRetryPlayerId) {
          autoRollRequests.push({ roomId, playerId: outcome.autoRetryPlayerId })
        }
      }
    }
    return { changedRoomIds: changedRooms, autoRollRequests }
  }

  async getRoomSnapshot(
    roomId: string,
    connectedPlayerIds: ReadonlySet<string>,
  ): Promise<RoomSnapshot> {
    const client = await this.pool.connect()
    try {
      const roomResult = await client.query<RoomRow>(
        'SELECT id, host_member_id FROM rooms WHERE id = $1',
        [roomId],
      )
      const room = roomResult.rows[0]
      if (!room) throw new RoomRepositoryError('not-found', '房间不存在')
      const membersResult = await client.query<MemberRow>(
        `
          SELECT id, display_name, seat, member_role
          FROM room_members
          WHERE room_id = $1 AND retired_at IS NULL
          ORDER BY seat NULLS LAST, joined_at, id
        `,
        [roomId],
      )
      const state = await this.loadActiveGame(client, roomId, false)
      const activeTurnResult = await client.query<TurnRow>(
        `
          SELECT * FROM turns
          WHERE game_id = $1 AND status IN ('awaiting-roll', 'rolling', 'tilt-decision')
          LIMIT 1
        `,
        [state.id],
      )
      const activeTurn = activeTurnResult.rows[0]
      const activeRollResult = activeTurn
        ? await client.query<ComputedRollRow>(
            `
              SELECT id, turn_id, player_id, seed, status, dice_values, judge_result, diagnostics,
                     reveal_at, throw_algorithm_version, settle_algorithm_version,
                     requires_tilt_decision
              FROM roll_attempts
              WHERE turn_id = $1 AND status IN ('computed', 'awaiting-tilt')
              ORDER BY attempt_number DESC
              LIMIT 1
            `,
            [activeTurn.id],
          )
        : { rows: [] }
      const activeRoll = activeRollResult.rows[0]
      const awardsByPlayer = Object.fromEntries(
        membersResult.rows.map((member) => [member.id, getPlayerAwardCounts(state, member.id)]),
      )
      return {
        protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
        roomId,
        gameId: state.id,
        phase: state.phase,
        revision: state.version,
        serverTime: new Date().toISOString(),
        hostPlayerId: room.host_member_id,
        members: membersResult.rows.map((member) => ({
          id: member.id,
          displayName: member.display_name,
          seat: member.seat,
          role: member.member_role,
          connected: connectedPlayerIds.has(member.id),
        })),
        currentTurn: activeTurn
          ? {
              id: activeTurn.id,
              sequence: activeTurn.sequence,
              cycleNumber: activeTurn.cycle_number,
              playerId: activeTurn.player_id,
              status: activeTurn.status as 'awaiting-roll' | 'rolling' | 'tilt-decision',
              deadlineAt: activeTurn.deadline_at.toISOString(),
              retryCount: activeTurn.retry_count,
            }
          : null,
        activeRoll: activeRoll
          ? {
              id: activeRoll.id,
              playerId: activeRoll.player_id,
              seed: Number(activeRoll.seed),
              revealAt: requireRollRevealAt(activeRoll).toISOString(),
              throwAlgorithmVersion: activeRoll.throw_algorithm_version,
              settleAlgorithmVersion: activeRoll.settle_algorithm_version,
            }
          : null,
        prizePool: { ...state.prizePool },
        awardsByPlayer,
        zhuangyuan: state.zhuangyuanHolder
          ? {
              playerId: state.zhuangyuanHolder.playerId,
              rollId: state.zhuangyuanHolder.rollId,
              diceValues: [...state.zhuangyuanHolder.diceValues],
              result: state.zhuangyuanHolder.result,
            }
          : null,
        recentRolls: state.rolls
          .slice(-20)
          .reverse()
          .map((roll) => ({
            id: roll.id,
            playerId: roll.playerId,
            diceValues: [...roll.diceValues],
            result: roll.result,
            awardTier: roll.awardTier,
            allocationReason: roll.allocationReason,
            createdAt: new Date(roll.createdAt).toISOString(),
          })),
        endDecisionDeadlineAt:
          state.endDecisionDeadlineAt === null
            ? null
            : new Date(state.endDecisionDeadlineAt).toISOString(),
      }
    } finally {
      client.release()
    }
  }

  private async insertLobbyGame(
    client: PoolClient,
    input: {
      roomId: string
      hostPlayerId: string
      players: readonly GamePlayer[]
    },
  ): Promise<MultiplayerGameState> {
    const game = createMultiplayerGame({
      id: randomUUID(),
      roomId: input.roomId,
      hostPlayerId: input.hostPlayerId,
      players: input.players,
    })
    await client.query(
      `
        INSERT INTO games (id, room_id, host_player_id)
        VALUES ($1, $2, $3)
      `,
      [game.id, game.roomId, game.hostPlayerId],
    )
    for (const player of game.players) {
      await client.query(
        `
          INSERT INTO game_players (game_id, player_id, display_name, seat)
          VALUES ($1, $2, $3, $4)
        `,
        [game.id, player.id, player.displayName, player.seat],
      )
    }
    for (const [tier, count] of Object.entries(INITIAL_PRIZE_POOL)) {
      await client.query(
        `
          INSERT INTO game_prize_pools (game_id, tier, initial_count, remaining_count)
          VALUES ($1, $2, $3, $3)
        `,
        [game.id, tier, count],
      )
    }
    return game
  }

  private async loadActiveGame(
    client: PoolClient,
    roomId: string,
    lock: boolean,
  ): Promise<MultiplayerGameState> {
    const gameResult = await client.query<GameRow>(
      `
        SELECT * FROM games
        WHERE room_id = $1
        ORDER BY (status IN ('lobby', 'playing', 'end-decision', 'bonus-round')) DESC, created_at DESC
        LIMIT 1
        ${lock ? 'FOR UPDATE' : ''}
      `,
      [roomId],
    )
    const game = gameResult.rows[0]
    if (!game) throw new RoomRepositoryError('not-found', '房间尚无游戏实例')

    // node-postgres 的单个 client 不允许并发 query；事务内按顺序读取同一快照。
    const playersResult = await client.query<PlayerRow>(
      'SELECT player_id, display_name, seat FROM game_players WHERE game_id = $1 ORDER BY seat',
      [game.id],
    )
    const poolResult = await client.query<PoolRow>(
      'SELECT tier, remaining_count FROM game_prize_pools WHERE game_id = $1',
      [game.id],
    )
    const turnsResult = await client.query<TurnRow>(
      'SELECT * FROM turns WHERE game_id = $1 ORDER BY sequence',
      [game.id],
    )
    const rollsResult = await client.query<RollRow>(
      `
        SELECT id, roll_sequence, player_id, dice_values, judge_result,
               award_tier, allocation_reason, created_at
        FROM roll_attempts
        WHERE game_id = $1 AND status = 'committed'
        ORDER BY roll_sequence
      `,
      [game.id],
    )
    const grantsResult = await client.query<GrantRow>(
      `
        SELECT id, roll_id, player_id, tier, grant_sequence
        FROM award_grants WHERE game_id = $1 ORDER BY grant_sequence
      `,
      [game.id],
    )
    const claimsResult = await client.query<ClaimRow>(
      `
        SELECT player_id, roll_id, claim_sequence, dice_values, judge_result
        FROM zhuangyuan_claims WHERE game_id = $1
      `,
      [game.id],
    )

    const players: GamePlayer[] = playersResult.rows.map((player) => ({
      id: player.player_id,
      displayName: player.display_name,
      seat: player.seat,
    }))
    const base = createMultiplayerGame({
      id: game.id,
      roomId: game.room_id,
      hostPlayerId: game.host_player_id,
      players,
    })
    const prizePool = { ...base.prizePool }
    for (const row of poolResult.rows) prizePool[row.tier] = row.remaining_count
    const activeRow = turnsResult.rows.find((turn) =>
      ['awaiting-roll', 'rolling', 'tilt-decision'].includes(turn.status),
    )
    const activeTurn: ActiveTurn | null = activeRow
      ? {
          id: activeRow.id,
          sequence: activeRow.sequence,
          cycleNumber: activeRow.cycle_number,
          playerId: activeRow.player_id,
          deadlineAt: activeRow.deadline_at.getTime(),
          retryCount: activeRow.retry_count,
        }
      : null
    const turnSkips: TurnSkipRecord[] = turnsResult.rows
      .filter((turn) => turn.status === 'skipped' && turn.skip_reason)
      .map((turn) => ({
        turnId: turn.id,
        sequence: turn.sequence,
        playerId: turn.player_id,
        reason: turn.skip_reason!,
        createdAt: turn.created_at.getTime(),
      }))
    const rolls: RollRecord[] = rollsResult.rows.map((roll) => ({
      id: roll.id,
      sequence: roll.roll_sequence,
      playerId: roll.player_id,
      diceValues: roll.dice_values,
      result: roll.judge_result,
      awardTier: roll.award_tier,
      allocationReason: roll.allocation_reason,
      createdAt: roll.created_at.getTime(),
    }))
    const awardGrants: AwardGrant[] = grantsResult.rows.map((grant) => ({
      id: grant.id,
      rollId: grant.roll_id,
      playerId: grant.player_id,
      tier: grant.tier,
      sequence: grant.grant_sequence,
    }))
    const zhuangyuanClaims = Object.fromEntries(
      claimsResult.rows.map((claim) => [
        claim.player_id,
        {
          playerId: claim.player_id,
          rollId: claim.roll_id,
          sequence: claim.claim_sequence,
          diceValues: claim.dice_values,
          result: claim.judge_result,
        } satisfies ZhuangyuanClaim,
      ]),
    )

    return {
      ...base,
      phase: parsePhase(game.status),
      version: numberVersion(game.version),
      prizePool,
      awardGrants,
      zhuangyuanClaims,
      zhuangyuanHolder: selectZhuangyuanHolder(zhuangyuanClaims),
      rolls,
      turnSkips,
      activeTurn,
      nextTurnSequence: game.next_turn_sequence,
      bonusQueue: game.bonus_queue,
      poolCompletedByPlayerId: game.pool_completed_by_player_id,
      endDecisionDeadlineAt: game.end_decision_deadline_at?.getTime() ?? null,
      startedAt: game.started_at?.getTime() ?? null,
      finishedAt: game.finished_at?.getTime() ?? null,
    }
  }

  private async persistStateTransition(
    client: PoolClient,
    before: MultiplayerGameState,
    after: MultiplayerGameState,
    eventType: string,
  ): Promise<void> {
    const updated = await client.query(
      `
        UPDATE games
        SET status = $3,
            version = $4,
            next_turn_sequence = $5,
            pool_completed_by_player_id = $6,
            end_decision_deadline_at = $7,
            bonus_queue = $8,
            started_at = $9,
            finished_at = $10,
            updated_at = now()
        WHERE id = $1 AND version = $2
      `,
      [
        before.id,
        before.version,
        after.phase,
        after.version,
        after.nextTurnSequence,
        after.poolCompletedByPlayerId,
        after.endDecisionDeadlineAt === null ? null : new Date(after.endDecisionDeadlineAt),
        after.bonusQueue,
        after.startedAt === null ? null : new Date(after.startedAt),
        after.finishedAt === null ? null : new Date(after.finishedAt),
      ],
    )
    if (updated.rowCount !== 1)
      throw new RoomRepositoryError('conflict', '游戏状态已被其他命令更新')

    if (before.activeTurn && before.activeTurn.id !== after.activeTurn?.id) {
      const skipped = after.turnSkips.find(({ turnId }) => turnId === before.activeTurn?.id)
      await client.query(
        `
          UPDATE turns
          SET status = $2, skip_reason = $3, completed_at = now()
          WHERE id = $1
        `,
        [before.activeTurn.id, skipped ? 'skipped' : 'completed', skipped?.reason ?? null],
      )
    }
    if (after.activeTurn && before.activeTurn?.id !== after.activeTurn.id) {
      await client.query(
        `
          INSERT INTO turns (
            id, game_id, sequence, cycle_number, player_id, status, deadline_at, retry_count
          ) VALUES ($1, $2, $3, $4, $5, 'awaiting-roll', $6, $7)
        `,
        [
          after.activeTurn.id,
          after.id,
          after.activeTurn.sequence,
          after.activeTurn.cycleNumber,
          after.activeTurn.playerId,
          new Date(after.activeTurn.deadlineAt),
          after.activeTurn.retryCount,
        ],
      )
    }
    await client.query(
      `
        INSERT INTO game_events (game_id, revision, event_type, payload)
        VALUES ($1, $2, $3, $4::jsonb)
      `,
      [
        after.id,
        after.version,
        eventType,
        JSON.stringify({ phase: after.phase, currentPlayerId: after.activeTurn?.playerId ?? null }),
      ],
    )
  }

  private async persistRollTransition(
    client: PoolClient,
    before: MultiplayerGameState,
    after: MultiplayerGameState,
    rollId: string,
    eventType: string,
  ): Promise<void> {
    const record = after.rolls.find(({ id }) => id === rollId)
    if (!record || before.rolls.some(({ id }) => id === rollId)) {
      throw new Error('结算状态缺少本次权威投掷记录')
    }

    await this.persistStateTransition(client, before, after, eventType)
    for (const [tier, remaining] of Object.entries(after.prizePool)) {
      await client.query(
        'UPDATE game_prize_pools SET remaining_count = $3 WHERE game_id = $1 AND tier = $2',
        [after.id, tier, remaining],
      )
    }
    const committed = await client.query(
      `
        UPDATE roll_attempts
        SET status = 'committed',
            roll_sequence = $2,
            judge_result = $3::jsonb,
            award_tier = $4,
            allocation_reason = $5,
            committed_at = now()
        WHERE id = $1 AND status IN ('computed', 'awaiting-tilt')
      `,
      [
        rollId,
        record.sequence,
        JSON.stringify(record.result),
        record.awardTier,
        record.allocationReason,
      ],
    )
    if (committed.rowCount !== 1) {
      throw new RoomRepositoryError('conflict', '投掷结果已经被其他命令处理')
    }

    const grant = after.awardGrants.find(({ rollId: grantRollId }) => grantRollId === rollId)
    if (grant) {
      await client.query(
        `
          INSERT INTO award_grants (
            id, game_id, roll_id, player_id, tier, grant_sequence
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [grant.id, after.id, grant.rollId, grant.playerId, grant.tier, grant.sequence],
      )
    }

    const claim = after.zhuangyuanClaims[record.playerId]
    if (claim?.rollId === rollId) {
      await client.query(
        `
          INSERT INTO zhuangyuan_claims (
            game_id, player_id, roll_id, claim_sequence, dice_values, judge_result
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
          ON CONFLICT (game_id, player_id) DO UPDATE
          SET roll_id = EXCLUDED.roll_id,
              claim_sequence = EXCLUDED.claim_sequence,
              dice_values = EXCLUDED.dice_values,
              judge_result = EXCLUDED.judge_result,
              updated_at = now()
        `,
        [
          after.id,
          claim.playerId,
          claim.rollId,
          claim.sequence,
          claim.diceValues,
          JSON.stringify(claim.result),
        ],
      )
    }
  }

  private async reopenTurnForRetry(
    client: PoolClient,
    state: MultiplayerGameState,
    turn: TurnRow,
    rollId: string,
    now: number,
    timing: GameTimingConfig,
    source: 'manual' | 'timeout',
  ): Promise<void> {
    await client.query("UPDATE roll_attempts SET status = 'rejected' WHERE id = $1", [rollId])
    await client.query(
      `
        UPDATE turns
        SET status = 'awaiting-roll',
            deadline_at = $2,
            retry_count = retry_count + 1
        WHERE id = $1
      `,
      [turn.id, new Date(now + timing.turnActionTimeoutMs)],
    )
    await this.bumpSameTurnRevision(client, state, 'tilt-result-retry', {
      rollId,
      playerId: turn.player_id,
      source,
    })
  }

  private async bumpSameTurnRevision(
    client: PoolClient,
    state: MultiplayerGameState,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const nextVersion = state.version + 1
    const updated = await client.query(
      'UPDATE games SET version = $3, updated_at = now() WHERE id = $1 AND version = $2',
      [state.id, state.version, nextVersion],
    )
    if (updated.rowCount !== 1) {
      throw new RoomRepositoryError('conflict', '游戏状态已被其他命令更新')
    }
    await client.query(
      `
        INSERT INTO game_events (game_id, revision, event_type, payload)
        VALUES ($1, $2, $3, $4::jsonb)
      `,
      [state.id, nextVersion, eventType, JSON.stringify(payload)],
    )
  }

  private async withTransaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const value = await action(client)
      await client.query('COMMIT')
      return value
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}
