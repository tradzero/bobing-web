import type { AwardTier, GamePhase, JudgeResult, PrizePoolCounts } from '@dice/game-domain'

export const MULTIPLAYER_PROTOCOL_VERSION = 1 as const

export const ROOM_DISPLAY_NAME_MAX_LENGTH = 32 as const
export const PLAYER_DISPLAY_NAME_MAX_LENGTH = 24 as const

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

export interface CreateOpenRoomRequest {
  displayName: string
  creatorDisplayName: string
}

export interface CreateOpenRoomResponse {
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
    }
  | { type: 'start-game'; commandId: string }
  | { type: 'request-roll'; commandId: string }
  | { type: 'tilt-decision'; commandId: string; decision: 'accept' | 'retry' }
  | { type: 'choose-end'; commandId: string; mode: 'immediate' | 'bonus-round' }
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
        | 'internal-error'
      message: string
      commandId?: string
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseCreateOpenRoomRequest(value: unknown): CreateOpenRoomRequest {
  if (!isRecord(value)) throw new TypeError('创建房间请求必须是对象')
  return {
    displayName: stringField(value, 'displayName', {
      min: 1,
      max: ROOM_DISPLAY_NAME_MAX_LENGTH,
    }),
    creatorDisplayName: stringField(value, 'creatorDisplayName', {
      min: 1,
      max: PLAYER_DISPLAY_NAME_MAX_LENGTH,
    }),
  }
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
