import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { Pool } from 'pg'

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
if (!databaseUrl) {
  console.error('多人 E2E 需要显式设置 TEST_DATABASE_URL；不会自动读取普通 DATABASE_URL')
  process.exit(2)
}

const runId = randomUUID()
const defaultRoomId = `e2e-default-${runId}`
const restartDefaultRoomId = `e2e-restart-default-${runId}`
const displayRunId = runId.slice(0, 12)
const roomNames = [`多人 E2E ${displayRunId} 甲`, `多人 E2E ${displayRunId} 乙`]
const restartRoomName = `重启 E2E ${displayRunId}`
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

class CommandError extends Error {
  constructor(exitCode) {
    super(`子命令退出码 ${exitCode}`)
    this.exitCode = exitCode
  }
}

function run(args, extraEnv = {}) {
  const result = spawnSync(packageManager, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new CommandError(result.status ?? 1)
}

let exitCode = 0
try {
  run(['run', 'build:server'])
  run(['exec', 'vite', 'build', '--mode', 'multiplayer-e2e'], {
    VITE_DEFAULT_ROOM_ID: defaultRoomId,
  })
  run(
    [
      'exec',
      'playwright',
      'test',
      'e2e/multiplayer.spec.ts',
      'e2e/multiplayer-restart.spec.ts',
      '--config',
      'playwright.multiplayer.config.ts',
    ],
    {
      MULTIPLAYER_E2E_RUN_ID: runId,
      MULTIPLAYER_E2E_DEFAULT_ROOM_ID: defaultRoomId,
      MULTIPLAYER_E2E_RESTART_DEFAULT_ROOM_ID: restartDefaultRoomId,
    },
  )
} catch (error) {
  if (!(error instanceof CommandError)) throw error
  exitCode = error.exitCode
} finally {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  try {
    await pool.query(
      'DELETE FROM rooms WHERE id = ANY($1::text[]) OR display_name = ANY($2::text[])',
      [
        [defaultRoomId, restartDefaultRoomId],
        [...roomNames, restartRoomName],
      ],
    )
  } catch (error) {
    console.error('[multiplayer-e2e] 清理随机测试房间失败', error)
    if (exitCode === 0) exitCode = 1
  } finally {
    await pool.end()
  }
}

process.exitCode = exitCode
