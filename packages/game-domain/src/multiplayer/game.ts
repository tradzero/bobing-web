import { judge } from '../rules/judge'
import type { JudgeResult } from '../rules/types'
import {
  AwardTier,
  allocateAward,
  awardTierForResult,
  createPrizePool,
  isPrizePoolDepleted,
  type PrizePoolCounts,
} from './awards'
import { createBonusRoundQueue, nextPlayerId, type SeatedPlayer } from './turn-order'
import {
  replacePlayerZhuangyuanClaim,
  selectZhuangyuanHolder,
  type ZhuangyuanClaim,
  type ZhuangyuanClaims,
} from './zhuangyuan'

export const GamePhase = {
  Lobby: 'lobby',
  Playing: 'playing',
  EndDecision: 'end-decision',
  BonusRound: 'bonus-round',
  Finished: 'finished',
  Abandoned: 'abandoned',
} as const

export type GamePhase = (typeof GamePhase)[keyof typeof GamePhase]

export interface GameTimingConfig {
  turnActionTimeoutMs: number
  tiltDecisionTimeoutMs: number
  endDecisionTimeoutMs: number
  maxAutoRetries: number
}

export interface GamePlayer extends SeatedPlayer {
  displayName: string
}

export interface ActiveTurn {
  id: string
  sequence: number
  cycleNumber: number
  playerId: string
  deadlineAt: number
  retryCount: number
}

export interface AwardGrant {
  id: string
  rollId: string
  playerId: string
  tier: Exclude<AwardTier, typeof AwardTier.ZhuangYuan>
  sequence: number
}

export interface RollRecord {
  id: string
  sequence: number
  playerId: string
  diceValues: number[]
  result: JudgeResult
  awardTier: AwardTier | null
  allocationReason:
    | 'granted'
    | 'no-prize'
    | 'out-of-stock'
    | 'zhuangyuan-claim'
    | 'bonus-no-allocation'
  createdAt: number
}

export interface TurnSkipRecord {
  turnId: string
  sequence: number
  playerId: string
  reason: 'turn-timeout' | 'roll-error-limit' | 'disconnected' | 'room-abandoned'
  createdAt: number
}

export interface MultiplayerGameState {
  id: string
  roomId: string
  hostPlayerId: string
  phase: GamePhase
  version: number
  players: GamePlayer[]
  prizePool: PrizePoolCounts
  awardGrants: AwardGrant[]
  zhuangyuanClaims: Record<string, ZhuangyuanClaim>
  zhuangyuanHolder: ZhuangyuanClaim | null
  rolls: RollRecord[]
  turnSkips: TurnSkipRecord[]
  activeTurn: ActiveTurn | null
  nextTurnSequence: number
  bonusQueue: string[]
  poolCompletedByPlayerId: string | null
  endDecisionDeadlineAt: number | null
  startedAt: number | null
  finishedAt: number | null
  abandonedAt: number | null
}

function requireTimestamp(timestamp: number): void {
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new RangeError('时间戳必须是非负有限数字')
  }
}

function requireDuration(name: string, duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError(`${name}必须是正有限数字`)
  }
}

export function validateGameTimingConfig(config: GameTimingConfig): GameTimingConfig {
  requireDuration('turnActionTimeoutMs', config.turnActionTimeoutMs)
  requireDuration('tiltDecisionTimeoutMs', config.tiltDecisionTimeoutMs)
  requireDuration('endDecisionTimeoutMs', config.endDecisionTimeoutMs)
  if (!Number.isInteger(config.maxAutoRetries) || config.maxAutoRetries < 0) {
    throw new RangeError('maxAutoRetries 必须是非负整数')
  }
  return { ...config }
}

function validatePlayers(players: readonly GamePlayer[]): GamePlayer[] {
  if (players.length < 1 || players.length > 12) {
    throw new RangeError('本局玩家数必须在 1 到 12 之间')
  }
  const normalized = [...players].sort((a, b) => a.seat - b.seat)
  const ids = new Set<string>()
  const seats = new Set<number>()
  const names = new Set<string>()
  for (const player of normalized) {
    const displayName = player.displayName.trim()
    const normalizedName = displayName.toLocaleLowerCase()
    if (!player.id || !displayName) throw new RangeError('玩家 ID 和昵称不能为空')
    if (!Number.isInteger(player.seat) || player.seat < 0) {
      throw new RangeError('座位必须是非负整数')
    }
    if (ids.has(player.id) || seats.has(player.seat) || names.has(normalizedName)) {
      throw new RangeError('玩家 ID、座位和不区分大小写的昵称必须唯一')
    }
    ids.add(player.id)
    seats.add(player.seat)
    names.add(normalizedName)
  }
  return normalized.map((player) => ({ ...player, displayName: player.displayName.trim() }))
}

function makeTurn(
  state: Pick<MultiplayerGameState, 'nextTurnSequence'>,
  playerId: string,
  cycleNumber: number,
  turnId: string,
  now: number,
  timing: GameTimingConfig,
): ActiveTurn {
  if (!turnId) throw new RangeError('回合 ID 不能为空')
  return {
    id: turnId,
    sequence: state.nextTurnSequence,
    cycleNumber,
    playerId,
    deadlineAt: now + timing.turnActionTimeoutMs,
    retryCount: 0,
  }
}

export function createMultiplayerGame(input: {
  id: string
  roomId: string
  hostPlayerId: string
  players: readonly GamePlayer[]
}): MultiplayerGameState {
  const players = validatePlayers(input.players)
  if (!input.id || !input.roomId) throw new RangeError('游戏 ID 和房间 ID 不能为空')
  if (!players.some(({ id }) => id === input.hostPlayerId)) {
    throw new RangeError('房主必须在本局玩家中')
  }

  return {
    id: input.id,
    roomId: input.roomId,
    hostPlayerId: input.hostPlayerId,
    phase: GamePhase.Lobby,
    version: 0,
    players,
    prizePool: createPrizePool(),
    awardGrants: [],
    zhuangyuanClaims: {},
    zhuangyuanHolder: null,
    rolls: [],
    turnSkips: [],
    activeTurn: null,
    nextTurnSequence: 1,
    bonusQueue: [],
    poolCompletedByPlayerId: null,
    endDecisionDeadlineAt: null,
    startedAt: null,
    finishedAt: null,
    abandonedAt: null,
  }
}

/**
 * 将长期没有真实玩家操作的进行中对局转为明确的废弃终态。
 * 当前回合只记录为废弃跳过，不创建下一回合，避免后台 deadline 无限自循环。
 */
export function abandonMultiplayerGame(
  state: MultiplayerGameState,
  now: number,
): MultiplayerGameState {
  if (
    state.phase !== GamePhase.Playing &&
    state.phase !== GamePhase.BonusRound &&
    state.phase !== GamePhase.EndDecision
  ) {
    throw new Error('只有进行中的游戏可以标记为废弃')
  }
  requireTimestamp(now)
  const turnSkips = state.activeTurn
    ? [
        ...state.turnSkips,
        {
          turnId: state.activeTurn.id,
          sequence: state.activeTurn.sequence,
          playerId: state.activeTurn.playerId,
          reason: 'room-abandoned' as const,
          createdAt: now,
        },
      ]
    : [...state.turnSkips]
  return {
    ...state,
    phase: GamePhase.Abandoned,
    version: state.version + 1,
    turnSkips,
    activeTurn: null,
    bonusQueue: [],
    endDecisionDeadlineAt: null,
    abandonedAt: now,
  }
}

export function startMultiplayerGame(
  state: MultiplayerGameState,
  input: { now: number; turnId: string; timing: GameTimingConfig },
): MultiplayerGameState {
  if (state.phase !== GamePhase.Lobby) throw new Error('只有等待中的房间可以开始')
  requireTimestamp(input.now)
  const timing = validateGameTimingConfig(input.timing)
  const firstPlayer = state.players[0]
  return {
    ...state,
    phase: GamePhase.Playing,
    version: state.version + 1,
    activeTurn: makeTurn(state, firstPlayer.id, 1, input.turnId, input.now, timing),
    nextTurnSequence: state.nextTurnSequence + 1,
    startedAt: input.now,
  }
}

function advanceRegularTurn(
  state: MultiplayerGameState,
  currentPlayerId: string,
  input: { now: number; turnId: string; timing: GameTimingConfig },
): Pick<MultiplayerGameState, 'activeTurn' | 'nextTurnSequence'> {
  const nextId = nextPlayerId(state.players, currentPlayerId)
  const currentSeat = state.players.find(({ id }) => id === currentPlayerId)?.seat
  const nextSeat = state.players.find(({ id }) => id === nextId)?.seat
  if (currentSeat === undefined || nextSeat === undefined) throw new Error('回合座位状态不一致')
  const currentCycle = state.activeTurn?.cycleNumber ?? 1
  const cycleNumber = nextSeat <= currentSeat ? currentCycle + 1 : currentCycle
  return {
    activeTurn: makeTurn(state, nextId, cycleNumber, input.turnId, input.now, input.timing),
    nextTurnSequence: state.nextTurnSequence + 1,
  }
}

function createAwardGrant(
  state: MultiplayerGameState,
  record: RollRecord,
  grantId: string,
): AwardGrant | null {
  if (!record.awardTier || record.awardTier === AwardTier.ZhuangYuan) return null
  if (record.allocationReason !== 'granted') return null
  if (!grantId) throw new RangeError('实体奖项领取 ID 不能为空')
  return {
    id: grantId,
    rollId: record.id,
    playerId: record.playerId,
    tier: record.awardTier,
    sequence: state.awardGrants.length + 1,
  }
}

function updateClaim(
  claims: ZhuangyuanClaims,
  record: RollRecord,
): Record<string, ZhuangyuanClaim> {
  if (record.awardTier !== AwardTier.ZhuangYuan) return { ...claims }
  return replacePlayerZhuangyuanClaim(claims, {
    playerId: record.playerId,
    rollId: record.id,
    sequence: record.sequence,
    diceValues: record.diceValues,
    result: record.result,
  })
}

export function recordAuthoritativeRoll(
  state: MultiplayerGameState,
  input: {
    playerId: string
    rollId: string
    diceValues: number[]
    now: number
    nextTurnId: string
    grantId: string
    timing: GameTimingConfig
  },
): MultiplayerGameState {
  if (state.phase !== GamePhase.Playing && state.phase !== GamePhase.BonusRound) {
    throw new Error('当前房间阶段不接受投掷结果')
  }
  if (!state.activeTurn || state.activeTurn.playerId !== input.playerId) {
    throw new Error('只有当前回合玩家可以提交投掷')
  }
  if (!input.rollId || state.rolls.some(({ id }) => id === input.rollId)) {
    throw new Error('投掷 ID 不能为空或重复')
  }
  requireTimestamp(input.now)
  const timing = validateGameTimingConfig(input.timing)
  const result = judge(input.diceValues)
  const awardTier = awardTierForResult(result)
  const inBonusRound = state.phase === GamePhase.BonusRound
  const allocation = inBonusRound
    ? {
        tier: awardTier,
        pool: { ...state.prizePool },
        reason: (awardTier === AwardTier.ZhuangYuan
          ? 'zhuangyuan-claim'
          : 'bonus-no-allocation') as RollRecord['allocationReason'],
      }
    : allocateAward(state.prizePool, result)

  const record: RollRecord = {
    id: input.rollId,
    sequence: state.rolls.length + 1,
    playerId: input.playerId,
    diceValues: [...input.diceValues],
    result,
    awardTier,
    allocationReason: allocation.reason,
    createdAt: input.now,
  }
  const zhuangyuanClaims = updateClaim(state.zhuangyuanClaims, record)
  const zhuangyuanHolder = selectZhuangyuanHolder(zhuangyuanClaims)
  const grant = createAwardGrant(state, record, input.grantId)
  const awardGrants = grant ? [...state.awardGrants, grant] : [...state.awardGrants]
  const common = {
    ...state,
    version: state.version + 1,
    prizePool: allocation.pool,
    awardGrants,
    zhuangyuanClaims,
    zhuangyuanHolder,
    rolls: [...state.rolls, record],
  }

  if (inBonusRound) {
    if (state.bonusQueue[0] !== input.playerId) {
      throw new Error('加赛队列与当前玩家不一致')
    }
    const bonusQueue = state.bonusQueue.slice(1)
    if (bonusQueue.length === 0) {
      return {
        ...common,
        phase: GamePhase.Finished,
        activeTurn: null,
        bonusQueue,
        finishedAt: input.now,
      }
    }
    return {
      ...common,
      activeTurn: makeTurn(
        state,
        bonusQueue[0],
        state.activeTurn.cycleNumber,
        input.nextTurnId,
        input.now,
        timing,
      ),
      nextTurnSequence: state.nextTurnSequence + 1,
      bonusQueue,
    }
  }

  if (isPrizePoolDepleted(allocation.pool, zhuangyuanHolder !== null)) {
    return {
      ...common,
      phase: GamePhase.EndDecision,
      activeTurn: null,
      poolCompletedByPlayerId: input.playerId,
      endDecisionDeadlineAt: input.now + timing.endDecisionTimeoutMs,
    }
  }

  return {
    ...common,
    ...advanceRegularTurn(state, input.playerId, {
      now: input.now,
      turnId: input.nextTurnId,
      timing,
    }),
  }
}

function advanceBonusAfterSkip(
  state: MultiplayerGameState,
  now: number,
  nextTurnId: string,
  timing: GameTimingConfig,
): MultiplayerGameState {
  const bonusQueue = state.bonusQueue.slice(1)
  if (bonusQueue.length === 0) {
    return {
      ...state,
      phase: GamePhase.Finished,
      version: state.version + 1,
      activeTurn: null,
      bonusQueue,
      finishedAt: now,
    }
  }
  return {
    ...state,
    version: state.version + 1,
    activeTurn: makeTurn(
      state,
      bonusQueue[0],
      state.activeTurn?.cycleNumber ?? 1,
      nextTurnId,
      now,
      timing,
    ),
    nextTurnSequence: state.nextTurnSequence + 1,
    bonusQueue,
  }
}

export function skipActiveTurn(
  state: MultiplayerGameState,
  input: {
    now: number
    nextTurnId: string
    reason: TurnSkipRecord['reason']
    timing: GameTimingConfig
  },
): MultiplayerGameState {
  if (!state.activeTurn) throw new Error('当前没有可跳过的回合')
  if (state.phase !== GamePhase.Playing && state.phase !== GamePhase.BonusRound) {
    throw new Error('当前房间阶段不允许跳过回合')
  }
  requireTimestamp(input.now)
  if (input.reason === 'turn-timeout' && input.now < state.activeTurn.deadlineAt) {
    throw new Error('回合尚未超时')
  }
  const timing = validateGameTimingConfig(input.timing)
  const turnSkips = [
    ...state.turnSkips,
    {
      turnId: state.activeTurn.id,
      sequence: state.activeTurn.sequence,
      playerId: state.activeTurn.playerId,
      reason: input.reason,
      createdAt: input.now,
    },
  ]
  const withSkip = { ...state, turnSkips }
  if (state.phase === GamePhase.BonusRound) {
    return advanceBonusAfterSkip(withSkip, input.now, input.nextTurnId, timing)
  }
  return {
    ...withSkip,
    version: state.version + 1,
    ...advanceRegularTurn(state, state.activeTurn.playerId, {
      now: input.now,
      turnId: input.nextTurnId,
      timing,
    }),
  }
}

export function chooseGameEndMode(
  state: MultiplayerGameState,
  input: {
    mode: 'immediate' | 'bonus-round'
    now: number
    turnId: string
    timing: GameTimingConfig
  },
): MultiplayerGameState {
  if (state.phase !== GamePhase.EndDecision || !state.poolCompletedByPlayerId) {
    throw new Error('当前不在游戏结束选择阶段')
  }
  requireTimestamp(input.now)
  const timing = validateGameTimingConfig(input.timing)
  if (input.mode === 'immediate') {
    return {
      ...state,
      phase: GamePhase.Finished,
      version: state.version + 1,
      endDecisionDeadlineAt: null,
      finishedAt: input.now,
    }
  }

  const bonusQueue = createBonusRoundQueue(state.players, state.poolCompletedByPlayerId)
  return {
    ...state,
    phase: GamePhase.BonusRound,
    version: state.version + 1,
    activeTurn: makeTurn(state, bonusQueue[0], 1, input.turnId, input.now, timing),
    nextTurnSequence: state.nextTurnSequence + 1,
    bonusQueue,
    endDecisionDeadlineAt: null,
  }
}

export function expireEndDecision(state: MultiplayerGameState, now: number): MultiplayerGameState {
  if (
    state.phase !== GamePhase.EndDecision ||
    state.endDecisionDeadlineAt === null ||
    now < state.endDecisionDeadlineAt
  ) {
    throw new Error('结束选择尚未超时')
  }
  return {
    ...state,
    phase: GamePhase.Finished,
    version: state.version + 1,
    endDecisionDeadlineAt: null,
    finishedAt: now,
  }
}

export function getPlayerAwardCounts(
  state: MultiplayerGameState,
  playerId: string,
): Record<AwardTier, number> {
  const counts: Record<AwardTier, number> = {
    zhuangyuan: state.zhuangyuanHolder?.playerId === playerId ? 1 : 0,
    duitang: 0,
    sanhong: 0,
    sijin: 0,
    erju: 0,
    yixiu: 0,
  }
  for (const grant of state.awardGrants) {
    if (grant.playerId === playerId) counts[grant.tier] += 1
  }
  return counts
}
