import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { Pool } from 'pg'
import { collectBrowserIssues } from './helpers/diagnostics'

interface CreateOpenRoomResponse {
  roomId: string
  resumeToken: string
}

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
const runId = process.env.MULTIPLAYER_E2E_RUN_ID?.trim()
const defaultRoomId = process.env.MULTIPLAYER_E2E_RESTART_DEFAULT_ROOM_ID?.trim()
if (!databaseUrl || !runId || !defaultRoomId) {
  throw new Error('重启 E2E 缺少数据库、运行 ID 或默认房间 ID')
}

const origin = 'http://127.0.0.1:4175'
const roomName = `重启 E2E ${runId.slice(0, 12)}`
const pool = new Pool({ connectionString: databaseUrl, max: 2 })
let serverProcess: ChildProcess | null = null
let serverOutput = ''
let createdRoomId: string | null = null

async function startServer(): Promise<void> {
  if (serverProcess) throw new Error('重启 E2E 服务已在运行')
  const child = spawn(process.execPath, ['dist-server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      SERVER_HOST: '127.0.0.1',
      SERVER_PORT: '4175',
      DEFAULT_ROOM_ID: defaultRoomId,
      AUTO_MIGRATE: 'true',
      MAX_ROOM_PLAYERS: '12',
      TURN_ACTION_TIMEOUT_MS: '30000',
      TILT_DECISION_TIMEOUT_MS: '10000',
      END_DECISION_TIMEOUT_MS: '30000',
      MAX_AUTO_RETRIES: '1',
      SCHEDULER_POLL_INTERVAL_MS: '100',
      ROLL_REVEAL_MIN_MS: '1200',
      ROLL_REVEAL_MAX_MS: '10000',
      DB_POOL_MAX: '4',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProcess = child
  child.stdout?.on('data', (chunk) => {
    serverOutput += chunk.toString()
  })
  child.stderr?.on('data', (chunk) => {
    serverOutput += chunk.toString()
  })

  const readyDeadline = Date.now() + 15_000
  while (Date.now() < readyDeadline) {
    if (child.exitCode !== null) {
      serverProcess = null
      throw new Error(`重启 E2E 服务提前退出 (${child.exitCode})\n${serverOutput}`)
    }
    try {
      const response = await fetch(`${origin}/readyz`)
      if (response.ok) return
    } catch {
      // 服务仍在启动；下一次短轮询继续检查进程和 readiness。
    }
    await delay(100)
  }
  await stopServer()
  throw new Error(`重启 E2E 服务启动超时\n${serverOutput}`)
}

async function stopServer(): Promise<void> {
  const child = serverProcess
  serverProcess = null
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const closed = await Promise.race([
    once(child, 'close').then(() => true),
    delay(5_000).then(() => false),
  ])
  if (closed) return
  child.kill('SIGKILL')
  await once(child, 'close')
}

async function createRoom(creatorDisplayName: string): Promise<CreateOpenRoomResponse> {
  const response = await fetch(`${origin}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: roomName, creatorDisplayName }),
  })
  if (!response.ok) throw new Error(`创建重启测试房间失败: ${response.status}`)
  return (await response.json()) as CreateOpenRoomResponse
}

async function restoreCreatedHost(
  page: Page,
  roomId: string,
  displayName: string,
  resumeToken: string,
): Promise<void> {
  await page.goto(origin)
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: `dice-room:${roomId}:session-v1`,
    value: JSON.stringify({ displayName, resumeToken }),
  })
  await page.goto(`${origin}/room/${encodeURIComponent(roomId)}`)
  await expect(page.locator('.room-header')).toContainText(displayName)
}

async function join(page: Page, roomId: string, displayName: string): Promise<void> {
  await page.goto(`${origin}/room/${encodeURIComponent(roomId)}`)
  await page.getByLabel('玩家昵称').fill(displayName)
  await page.getByRole('button', { name: '加入房间' }).click()
  await expect(page.locator('.room-header')).toContainText(displayName)
}

test.beforeAll(async () => {
  await pool.query('DELETE FROM rooms WHERE id = $1 OR display_name = $2', [
    defaultRoomId,
    roomName,
  ])
  await startServer()
})

test.afterAll(async () => {
  await stopServer()
  await pool.query('DELETE FROM rooms WHERE id = ANY($1::text[]) OR display_name = $2', [
    [defaultRoomId, ...(createdRoomId ? [createdRoomId] : [])],
    roomName,
  ])
  await pool.end()
})

test('服务重启后恢复浏览器身份，并按 PostgreSQL 绝对 deadline 推进回合', async ({ browser }) => {
  const contexts: BrowserContext[] = []
  try {
    const created = await createRoom('Restart Alice')
    createdRoomId = created.roomId
    const aliceContext = await browser.newContext()
    const bobContext = await browser.newContext()
    contexts.push(aliceContext, bobContext)
    const alice = await aliceContext.newPage()
    const bob = await bobContext.newPage()
    const aliceIssues = collectBrowserIssues(alice)
    const bobIssues = collectBrowserIssues(bob)

    await restoreCreatedHost(alice, createdRoomId, 'Restart Alice', created.resumeToken)
    await join(bob, createdRoomId, 'Restart Bob')
    await expect(alice.getByText('2 位玩家已入座')).toBeVisible()
    await alice.getByRole('button', { name: '开始博饼' }).click()
    await expect(alice.getByText('轮到你了')).toBeVisible()

    await stopServer()
    await expect(alice.locator('.room-connection-banner')).toBeVisible()
    await expect(bob.locator('.room-connection-banner')).toBeVisible()
    const expired = await pool.query(
      `
        UPDATE turns t
        SET deadline_at = now() - interval '1 second'
        FROM games g
        WHERE t.game_id = g.id
          AND g.room_id = $1
          AND t.status = 'awaiting-roll'
      `,
      [createdRoomId],
    )
    expect(expired.rowCount).toBe(1)

    await startServer()
    await expect(alice.locator('.room-connection-banner')).toHaveCount(0)
    await expect(bob.locator('.room-connection-banner')).toHaveCount(0)
    await expect(alice.locator('.room-header')).toContainText('Restart Alice')
    await expect(bob.locator('.room-header')).toContainText('Restart Bob')
    await expect(bob.getByText('轮到你了')).toBeVisible()
    await expect(alice.getByRole('button', { name: '投掷六骰' })).toHaveCount(0)

    const activeTurn = await pool.query<{ display_name: string; sequence: number }>(
      `
        SELECT m.display_name, t.sequence
        FROM turns t
        JOIN games g ON g.id = t.game_id
        JOIN room_members m ON m.id = t.player_id
        WHERE g.room_id = $1 AND t.status = 'awaiting-roll'
      `,
      [createdRoomId],
    )
    expect(activeTurn.rows).toEqual([{ display_name: 'Restart Bob', sequence: 2 }])
    expect(aliceIssues.pageErrors).toEqual([])
    expect(aliceIssues.consoleErrors).toEqual([])
    expect(bobIssues.pageErrors).toEqual([])
    expect(bobIssues.consoleErrors).toEqual([])
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})
