// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { loadServerConfig } from './env'

describe('服务端环境变量', () => {
  it('只强制要求 DATABASE_URL，其余使用已确认默认值', () => {
    expect(loadServerConfig({ DATABASE_URL: 'postgresql://localhost/dice' })).toMatchObject({
      host: '0.0.0.0',
      port: 8787,
      defaultRoomId: 'default',
      maxRoomPlayers: 12,
      autoMigrate: false,
      schedulerPollIntervalMs: 500,
      lifecyclePollIntervalMs: 60_000,
      rollRevealMinMs: 1_200,
      rollRevealMaxMs: 10_000,
      timing: {
        turnActionTimeoutMs: 30_000,
        tiltDecisionTimeoutMs: 10_000,
        endDecisionTimeoutMs: 30_000,
        maxAutoRetries: 1,
      },
      lifecycle: {
        emptyRoomTtlMs: 3_600_000,
        gameIdleAbandonMs: 1_800_000,
        roomIdleArchiveMs: 86_400_000,
        archivedRoomRetentionMs: 604_800_000,
      },
    })
  })

  it('所有倒计时都可通过环境变量调整', () => {
    const config = loadServerConfig({
      DATABASE_URL: 'postgresql://localhost/dice',
      TURN_ACTION_TIMEOUT_MS: '45000',
      TILT_DECISION_TIMEOUT_MS: '15000',
      END_DECISION_TIMEOUT_MS: '60000',
      MAX_AUTO_RETRIES: '2',
      EMPTY_ROOM_TTL_MS: '7200000',
      GAME_IDLE_ABANDON_MS: '3600000',
      ROOM_IDLE_ARCHIVE_MS: '172800000',
      ARCHIVED_ROOM_RETENTION_MS: '1209600000',
      ROOM_LIFECYCLE_POLL_INTERVAL_MS: '30000',
    })
    expect(config.timing).toEqual({
      turnActionTimeoutMs: 45_000,
      tiltDecisionTimeoutMs: 15_000,
      endDecisionTimeoutMs: 60_000,
      maxAutoRetries: 2,
    })
    expect(config.lifecycle).toEqual({
      emptyRoomTtlMs: 7_200_000,
      gameIdleAbandonMs: 3_600_000,
      roomIdleArchiveMs: 172_800_000,
      archivedRoomRetentionMs: 1_209_600_000,
    })
    expect(config.lifecyclePollIntervalMs).toBe(30_000)
  })

  it('拒绝过短倒计时、非整数端口和非法布尔值', () => {
    expect(() =>
      loadServerConfig({
        DATABASE_URL: 'postgresql://localhost/dice',
        TURN_ACTION_TIMEOUT_MS: '1',
      }),
    ).toThrow(/TURN_ACTION_TIMEOUT_MS/)
    expect(() =>
      loadServerConfig({ DATABASE_URL: 'postgresql://localhost/dice', SERVER_PORT: '1.5' }),
    ).toThrow(/SERVER_PORT/)
    expect(() =>
      loadServerConfig({ DATABASE_URL: 'postgresql://localhost/dice', AUTO_MIGRATE: 'yes' }),
    ).toThrow(/AUTO_MIGRATE/)
    expect(() =>
      loadServerConfig({
        DATABASE_URL: 'postgresql://localhost/dice',
        ROLL_REVEAL_MIN_MS: '9000',
        ROLL_REVEAL_MAX_MS: '8000',
      }),
    ).toThrow(/ROLL_REVEAL_MAX_MS/)
    expect(() =>
      loadServerConfig({
        DATABASE_URL: 'postgresql://localhost/dice',
        GAME_IDLE_ABANDON_MS: '120000',
        ROOM_IDLE_ARCHIVE_MS: '60000',
      }),
    ).toThrow(/ROOM_IDLE_ARCHIVE_MS/)
  })
})
