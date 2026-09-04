import type { AwardTier, GamePhase, JudgeResult, PrizePoolCounts } from '@dice/game-domain'

export const MULTIPLAYER_PROTOCOL_VERSION = 1 as const

export const ROOM_DISPLAY_NAME_MAX_LENGTH = 32 as const
export const PLAYER_DISPLAY_NAME_MAX_LENGTH = 24 as const
export const ROOM_PASSWORD_MIN_LENGTH = 4 as const
export const ROOM_PASSWORD_MAX_LENGTH = 64 as const

export interface RoomDirectoryEntry {
  id: string
  displayName: string
  accessType: 'open' | 'password'
  phase: GamePhase | 'empty'
  playerCount: number
  spectatorCount: number
}

export interface RoomDirectoryResponse {
  rooms: RoomDirectoryEntry[]
}

export interface CreateRoomRequest {
  displayName: string
  creatorDisplayName: string
  password?: string
}

export interface CreateRoomResponse {
  roomId: string
  resumeToken: string
}

export interface RoomMemberSnapshot {
  id: string
  displayName: string
  seat: number | null
  role: 'player' | 'spectator'
  connected: boolean
}

export interface TurnSnapshot {
  id: string
  sequence: number
  cycleNumber: number
  playerId: string
  status: 'awaiting-roll' | 'rolling' | 'tilt-decision'
  deadlineAt: string
  retryCount: number
}

export interface RollSnapshot {
  id: string
  playerId: string
  diceValues: number[]
  result: JudgeResult
  awardTier: AwardTier | null
  allocationReason: string
  createdAt: string
}

export interface ActiveRollSnapshot {
  id: string
  playerId: string
  seed: number
  revealAt: string
  throwAlgorithmVersion: string
  settleAlgorithmVersion: string
}

export interface ZhuangyuanSnapshot {
  playerId: string
  rollId: string
  diceValues: number[]
  result: JudgeResult
}

export interface RoomSnapshot {
  protocolVersion: typeof MULTIPLAYER_PROTOCOL_VERSION
  roomId: string
  roomDisplayName: string
  gameId: string | null
  phase: GamePhase
  revision: number
  serverTime: string
  hostPlayerId: string | null
  members: RoomMemberSnapshot[]
  currentTurn: TurnSnapshot | null
  activeRoll: ActiveRollSnapshot | null
  prizePool: PrizePoolCounts
  awardsByPlayer: Record<string, Record<AwardTier, number>>
  zhuangyuan: ZhuangyuanSnapshot | null
  recentRolls: RollSnapshot[]
  endDecisionDeadlineAt: string | null
}

export type ClientMessage =
  | {
      type: 'join-room'
      protocolVersion: typeof MULTIPLAYER_PROTOCOL_VERSION
      roomId: string
      displayName: string
      resumeToken?: string
      password?: string
    }
  | { type: 'start-game'; commandId: string }
  | { type: 'request-roll'; commandId: string }
  | { type: 'tilt-decision'; commandId: string; decision: 'accept' | 'retry' }
  | { type: 'choose-end'; commandId: string; mode: 'immediate' | 'bonus-round' }
  | { type: 'close-room'; commandId: string }
  | { type: 'ping'; clientTime: string }

export type ServerMessage =
  | {
      type: 'joined'
      protocolVersion: typeof MULTIPLAYER_PROTOCOL_VERSION
      playerId: string
      resumeToken: string
      snapshot: RoomSnapshot
    }
  | { type: 'snapshot'; snapshot: RoomSnapshot }
  | {
      type: 'roll-started'
      rollId: string
      playerId: string
      seed: number
      revealAt: string
      throwAlgorithmVersion: string
      settleAlgorithmVersion: string
    }
  | { type: 'pong'; serverTime: string; clientTime: string }
  | {
      type: 'error'
      code:
        | 'invalid-message'
        | 'protocol-mismatch'
        | 'not-joined'
        | 'forbidden'
        | 'conflict'
        | 'room-full'
        | 'not-found'
        | 'room-closed'
        | 'internal-error'
      message: string
      commandId?: string
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseCreateRoomRequest(value: unknown): CreateRoomRequest {
  if (!isRecord(value)) throw new TypeError('创建房间请求必须是对象')
  const password = optionalRoomPassword(value.password)
  return {
    displayName: stringField(value, 'displayName', {
      min: 1,
      max: ROOM_DISPLAY_NAME_MAX_LENGTH,
    }),
    creatorDisplayName: stringField(value, 'creatorDisplayName', {
      min: 1,
      max: PLAYER_DISPLAY_NAME_MAX_LENGTH,
    }),
    ...(password === undefined ? {} : { password }),
  }
}

function optionalRoomPassword(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new TypeError('password 必须是字符串')
  if (value.length < ROOM_PASSWORD_MIN_LENGTH || value.length > ROOM_PASSWORD_MAX_LENGTH) {
    throw new RangeError(
      `password 长度必须在 ${ROOM_PASSWORD_MIN_LENGTH}..${ROOM_PASSWORD_MAX_LENGTH} 之间`,
    )
  }
  return value
}

function stringField(
  value: Record<string, unknown>,
  name: string,
  options: { min: number; max: number },
): string {
  const field = value[name]
  if (typeof field !== 'string') throw new TypeError(`${name} 必须是字符串`)
  const normalized = field.trim()
  if (normalized.length < options.min || normalized.length > options.max) {
    throw new RangeError(`${name} 长度必须在 ${options.min}..${options.max} 之间`)
  }
  return normalized
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function commandId(value: Record<string, unknown>): string {
  const raw = value.commandId
  if (typeof raw !== 'string') throw new TypeError('commandId 必须是 UUID 字符串')
  const id = raw.trim()
  if (!UUID_PATTERN.test(id)) throw new RangeError('commandId 必须是 UUID')
  return id
}

export function parseClientMessage(raw: string): ClientMessage {
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw new TypeError('消息必须是合法 JSON')
  }
  if (!isRecord(decoded) || typeof decoded.type !== 'string') {
    throw new TypeError('消息必须包含 type')
  }

  switch (decoded.type) {
    case 'join-room': {
      if (decoded.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) {
        throw new RangeError('客户端协议版本不匹配')
      }
      const resumeToken = decoded.resumeToken
      const password = optionalRoomPassword(decoded.password)
      if (
        resumeToken !== undefined &&
        (typeof resumeToken !== 'string' || resumeToken.length > 256)
      ) {
        throw new RangeError('resumeToken 不合法')
      }
      return {
        type: 'join-room',
        protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
        roomId: stringField(decoded, 'roomId', { min: 1, max: 64 }),
        displayName: stringField(decoded, 'displayName', {
          min: 1,
          max: PLAYER_DISPLAY_NAME_MAX_LENGTH,
        }),
        ...(resumeToken ? { resumeToken } : {}),
        ...(password === undefined ? {} : { password }),
      }
    }
    case 'start-game':
      return { type: 'start-game', commandId: commandId(decoded) }
    case 'request-roll':
      return { type: 'request-roll', commandId: commandId(decoded) }
    case 'tilt-decision': {
      if (decoded.decision !== 'accept' && decoded.decision !== 'retry') {
        throw new RangeError('tilt-decision 只接受 accept/retry')
      }
      return {
        type: 'tilt-decision',
        commandId: commandId(decoded),
        decision: decoded.decision,
      }
    }
    case 'choose-end': {
      if (decoded.mode !== 'immediate' && decoded.mode !== 'bonus-round') {
        throw new RangeError('choose-end 只接受 immediate/bonus-round')
      }
      return { type: 'choose-end', commandId: commandId(decoded), mode: decoded.mode }
    }
    case 'close-room':
      return { type: 'close-room', commandId: commandId(decoded) }
    case 'ping':
      return {
        type: 'ping',
        clientTime: stringField(decoded, 'clientTime', { min: 1, max: 64 }),
      }
    default:
      throw new RangeError(`未知消息类型 ${decoded.type}`)
  }
}

export function serializeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message)
}
