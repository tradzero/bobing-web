import type { GameTimingConfig } from '@dice/game-domain'
import type { RoomLifecycleConfig } from '../room/repository'

export interface ServerConfig {
  databaseUrl: string
  host: string
  port: number
  defaultRoomId: string
  maxRoomPlayers: number
  dbPoolMax: number
  autoMigrate: boolean
  schedulerPollIntervalMs: number
  lifecyclePollIntervalMs: number
  rollRevealMinMs: number
  rollRevealMaxMs: number
  timing: GameTimingConfig
  lifecycle: RoomLifecycleConfig
}

function requiredString(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`缺少必需环境变量 ${name}`)
  return value
}

function optionalString(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  return env[name]?.trim() || fallback
}

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  range: { min: number; max: number },
): number {
  const raw = env[name]
  const value = raw === undefined || raw.trim() === '' ? fallback : Number(raw)
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new RangeError(`${name} 必须是 ${range.min}..${range.max} 之间的整数`)
  }
  return value
}

function boolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  throw new RangeError(`${name} 只接受 true/false/1/0`)
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const maxRoomPlayers = integer(env, 'MAX_ROOM_PLAYERS', 12, { min: 1, max: 12 })
  const rollRevealMinMs = integer(env, 'ROLL_REVEAL_MIN_MS', 1_200, {
    min: 0,
    max: 30_000,
  })
  const rollRevealMaxMs = integer(env, 'ROLL_REVEAL_MAX_MS', 10_000, {
    min: 1_000,
    max: 60_000,
  })
  if (rollRevealMaxMs < rollRevealMinMs) {
    throw new RangeError('ROLL_REVEAL_MAX_MS 不能小于 ROLL_REVEAL_MIN_MS')
  }
  const gameIdleAbandonMs = integer(env, 'GAME_IDLE_ABANDON_MS', 30 * 60_000, {
    min: 60_000,
    max: 30 * 24 * 60 * 60_000,
  })
  const roomIdleArchiveMs = integer(env, 'ROOM_IDLE_ARCHIVE_MS', 24 * 60 * 60_000, {
    min: 60_000,
    max: 365 * 24 * 60 * 60_000,
  })
  if (roomIdleArchiveMs < gameIdleAbandonMs) {
    throw new RangeError('ROOM_IDLE_ARCHIVE_MS 不能小于 GAME_IDLE_ABANDON_MS')
  }
  return {
    databaseUrl: requiredString(env, 'DATABASE_URL'),
    host: optionalString(env, 'SERVER_HOST', '0.0.0.0'),
    port: integer(env, 'SERVER_PORT', 8787, { min: 1, max: 65_535 }),
    defaultRoomId: optionalString(env, 'DEFAULT_ROOM_ID', 'default'),
    maxRoomPlayers,
    dbPoolMax: integer(env, 'DB_POOL_MAX', 10, { min: 1, max: 100 }),
    autoMigrate: boolean(env, 'AUTO_MIGRATE', false),
    schedulerPollIntervalMs: integer(env, 'SCHEDULER_POLL_INTERVAL_MS', 500, {
      min: 100,
      max: 5_000,
    }),
    lifecyclePollIntervalMs: integer(env, 'ROOM_LIFECYCLE_POLL_INTERVAL_MS', 60_000, {
      min: 1_000,
      max: 300_000,
    }),
    rollRevealMinMs,
    rollRevealMaxMs,
    timing: {
      turnActionTimeoutMs: integer(env, 'TURN_ACTION_TIMEOUT_MS', 30_000, {
        min: 10_000,
        max: 300_000,
      }),
      tiltDecisionTimeoutMs: integer(env, 'TILT_DECISION_TIMEOUT_MS', 10_000, {
        min: 3_000,
        max: 120_000,
      }),
      endDecisionTimeoutMs: integer(env, 'END_DECISION_TIMEOUT_MS', 30_000, {
        min: 5_000,
        max: 300_000,
      }),
      maxAutoRetries: integer(env, 'MAX_AUTO_RETRIES', 1, { min: 0, max: 5 }),
    },
    lifecycle: {
      emptyRoomTtlMs: integer(env, 'EMPTY_ROOM_TTL_MS', 60 * 60_000, {
        min: 60_000,
        max: 30 * 24 * 60 * 60_000,
      }),
      gameIdleAbandonMs,
      roomIdleArchiveMs,
      archivedRoomRetentionMs: integer(env, 'ARCHIVED_ROOM_RETENTION_MS', 7 * 24 * 60 * 60_000, {
        min: 60_000,
        max: 365 * 24 * 60 * 60_000,
      }),
    },
  }
}
