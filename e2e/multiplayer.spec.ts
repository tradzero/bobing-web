import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import NodeWebSocket, { type RawData } from 'ws'
import { collectBrowserIssues } from './helpers/diagnostics'

interface SocketServerMessage {
  type: string
}

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
const runId = process.env.MULTIPLAYER_E2E_RUN_ID?.trim()
const defaultRoomId = process.env.MULTIPLAYER_E2E_DEFAULT_ROOM_ID?.trim()
if (!databaseUrl || !runId || !defaultRoomId) {
  throw new Error('多人 E2E 缺少数据库、运行 ID 或默认房间 ID')
}

const displayRunId = runId.slice(0, 12)
const roomNames = [`多人 E2E ${displayRunId} 甲`, `多人 E2E ${displayRunId} 乙`]
const createdRoomIds = new Set<string>()
const pool = new Pool({ connectionString: databaseUrl, max: 2 })

function roomIdFromUrl(page: Page): string {
  const match = new URL(page.url()).pathname.match(/^\/room\/([^/]+)$/)
  if (!match?.[1]) throw new Error(`页面未进入房间 URL: ${page.url()}`)
  return decodeURIComponent(match[1])
}

async function joinCurrentRoom(page: Page, displayName: string): Promise<void> {
  await page.getByLabel('玩家昵称').fill(displayName)
  await page.getByRole('button', { name: '加入房间' }).click()
  await expect(page.locator('.room-header')).toContainText(displayName)
}

async function createAndJoinRoom(
  page: Page,
  roomName: string,
  displayName: string,
): Promise<string> {
  await page.goto('/rooms')
  await page.getByLabel('房间名称').fill(roomName)
  await page.getByLabel('你的昵称').fill(displayName)
  await page.getByRole('button', { name: '创建并进入' }).click()
  await page.waitForURL(/\/room\/[^/]+$/)
  const roomId = roomIdFromUrl(page)
  createdRoomIds.add(roomId)
  await expect(page.locator('.room-header')).toContainText(displayName)
  await expect(page.locator('.room-header')).toContainText(roomName)
  return roomId
}

async function enterListedRoom(page: Page, roomName: string): Promise<void> {
  await page.goto('/rooms')
  await page.getByRole('link', { name: new RegExp(roomName) }).click()
  await page.waitForURL(/\/room\/[^/]+$/)
}

async function installWebSocketInterruptionControl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sockets: WebSocket[] = []
    const TrackedWebSocket = new Proxy(window.WebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args) as WebSocket
        sockets.push(socket)
        return socket
      },
    })
    Object.defineProperty(window, 'WebSocket', { value: TrackedWebSocket })
    Object.defineProperty(window, '__diceCloseLatestWebSocket', {
      value: () => sockets.at(-1)?.close(),
    })
  })
}

async function interruptLatestWebSocket(page: Page): Promise<void> {
  await page.evaluate(() => {
    const controlledWindow = window as typeof window & {
      __diceCloseLatestWebSocket?: () => void
    }
    if (!controlledWindow.__diceCloseLatestWebSocket) {
      throw new Error('Playwright 未安装 WebSocket 中断控制')
    }
    controlledWindow.__diceCloseLatestWebSocket()
  })
}

async function acceptTiltIfNeeded(page: Page, expectedHistoryCount = 1): Promise<void> {
  const history = page.locator('.room-history > div')
  const tilt = page.getByText('骰子姿态需要确认')
  const outcome = await Promise.race([
    history
      .nth(expectedHistoryCount - 1)
      .waitFor({ state: 'visible' })
      .then(() => 'settled' as const),
    tilt.waitFor({ state: 'visible' }).then(() => 'tilt' as const),
  ])
  if (outcome === 'tilt') {
    await page.getByRole('button', { name: '接受结果' }).click()
    await expect(history).toHaveCount(expectedHistoryCount)
  }
}

function waitForSocketMessage(
  socket: NodeWebSocket,
  predicate: (message: SocketServerMessage) => boolean,
): Promise<SocketServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('等待 WebSocket 消息超时')), 20_000)
    const onMessage = (data: RawData) => {
      let message: SocketServerMessage
      try {
        message = JSON.parse(data.toString('utf8')) as SocketServerMessage
      } catch {
        return
      }
      if (predicate(message)) finish(undefined, message)
    }
    const onError = (error: Error) => finish(error)
    const onClose = () => finish(new Error('WebSocket 在收到目标消息前关闭'))
    const finish = (error?: Error, message?: SocketServerMessage) => {
      clearTimeout(timer)
      socket.off('message', onMessage)
      socket.off('error', onError)
      socket.off('close', onClose)
      if (error) reject(error)
      else resolve(message!)
    }
    socket.on('message', onMessage)
    socket.once('error', onError)
    socket.once('close', onClose)
  })
}

async function openPlayerSocket(
  roomId: string,
  displayName: string,
  resumeToken: string,
): Promise<NodeWebSocket> {
  const socket = new NodeWebSocket('ws://127.0.0.1:4174/ws')
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  const joined = waitForSocketMessage(socket, (message) => message.type === 'joined')
  socket.send(
    JSON.stringify({
      type: 'join-room',
      protocolVersion: 1,
      roomId,
      displayName,
      resumeToken,
    }),
  )
  await joined
  return socket
}

async function readResumeToken(page: Page, roomId: string): Promise<string> {
  const raw = await page.evaluate(
    (key) => localStorage.getItem(key),
    `dice-room:${roomId}:session-v1`,
  )
  const session = raw ? (JSON.parse(raw) as { resumeToken?: unknown }) : null
  if (typeof session?.resumeToken !== 'string') throw new Error('浏览器未保存恢复令牌')
  return session.resumeToken
}

test.beforeAll(async () => {
  await pool.query('DELETE FROM rooms WHERE display_name = ANY($1::text[])', [roomNames])
})

test.afterAll(async () => {
  await pool.query(
    'DELETE FROM rooms WHERE id = ANY($1::text[]) OR display_name = ANY($2::text[])',
    [[...createdRoomIds], roomNames],
  )
  await pool.end()
})

test('从房间大厅创建两个房间，并保持玩家、游戏、投掷和身份互相隔离', async ({ browser }) => {
  const contexts: BrowserContext[] = []
  try {
    const aliceContext = await browser.newContext()
    const bobContext = await browser.newContext()
    const carolContext = await browser.newContext()
    const danContext = await browser.newContext()
    contexts.push(aliceContext, bobContext, carolContext, danContext)

    const alice = await aliceContext.newPage()
    const bob = await bobContext.newPage()
    const carol = await carolContext.newPage()
    const dan = await danContext.newPage()
    await installWebSocketInterruptionControl(bob)
    const aliceIssues = collectBrowserIssues(alice)
    const bobIssues = collectBrowserIssues(bob)
    const carolIssues = collectBrowserIssues(carol)
    const danIssues = collectBrowserIssues(dan)

    await alice.goto('/')
    await expect(alice.getByText(`房间 ${defaultRoomId}`)).toBeVisible()
    const firstRoomId = await createAndJoinRoom(alice, roomNames[0], 'Alice E2E')
    await enterListedRoom(bob, roomNames[0])
    expect(roomIdFromUrl(bob)).toBe(firstRoomId)
    await joinCurrentRoom(bob, 'Bob E2E')

    const secondRoomId = await createAndJoinRoom(carol, roomNames[1], 'Carol E2E')
    expect(secondRoomId).not.toBe(firstRoomId)
    await enterListedRoom(dan, roomNames[1])
    expect(roomIdFromUrl(dan)).toBe(secondRoomId)
    await joinCurrentRoom(dan, 'Dan E2E')

    await expect(alice.getByText('2 位玩家已入座')).toBeVisible()
    await expect(carol.getByText('2 位玩家已入座')).toBeVisible()
    await expect(alice.locator('.room-player-awards')).not.toContainText('Carol E2E')
    await expect(carol.locator('.room-player-awards')).not.toContainText('Alice E2E')

    await interruptLatestWebSocket(bob)
    await expect(bob.locator('.room-connection-banner')).toBeVisible()
    await expect(bob.locator('.room-connection-banner')).toHaveCount(0)
    await expect(bob.locator('.room-header')).toContainText('Bob E2E')

    await Promise.all([
      alice.getByRole('button', { name: '开始博饼' }).click(),
      carol.getByRole('button', { name: '开始博饼' }).click(),
    ])
    await expect(alice.getByText('轮到你了')).toBeVisible()
    await expect(carol.getByText('轮到你了')).toBeVisible()
    await expect(bob.getByRole('button', { name: '投掷六骰' })).toHaveCount(0)
    await expect(dan.getByRole('button', { name: '投掷六骰' })).toHaveCount(0)

    await Promise.all([
      alice.getByRole('button', { name: '投掷六骰' }).click(),
      carol.getByRole('button', { name: '投掷六骰' }).click(),
    ])
    await Promise.all([acceptTiltIfNeeded(alice), acceptTiltIfNeeded(carol)])

    await expect(alice.locator('.room-history > div')).toHaveCount(1)
    await expect(bob.locator('.room-history > div')).toHaveCount(1)
    await expect(carol.locator('.room-history > div')).toHaveCount(1)
    await expect(dan.locator('.room-history > div')).toHaveCount(1)
    expect(await bob.locator('.room-history > div').first().innerText()).toBe(
      await alice.locator('.room-history > div').first().innerText(),
    )
    expect(await dan.locator('.room-history > div').first().innerText()).toBe(
      await carol.locator('.room-history > div').first().innerText(),
    )
    await expect(bob.getByText('轮到你了')).toBeVisible()
    await expect(dan.getByText('轮到你了')).toBeVisible()

    await bob.reload()
    await expect(bob.locator('.room-header')).toContainText('Bob E2E')
    await expect(bob.locator('.room-header')).toContainText(roomNames[0])
    await expect(bob.getByRole('button', { name: '加入房间' })).toHaveCount(0)
    await expect(bob.getByRole('button', { name: '投掷六骰' })).toBeVisible()

    const resumeToken = await readResumeToken(bob, firstRoomId)
    const duplicateSocket = await openPlayerSocket(firstRoomId, 'Bob E2E', resumeToken)
    try {
      const commandId = randomUUID()
      const rollStarted = waitForSocketMessage(
        duplicateSocket,
        (message) => message.type === 'roll-started',
      )
      const command = JSON.stringify({ type: 'request-roll', commandId })
      duplicateSocket.send(command)
      duplicateSocket.send(command)
      await rollStarted
      await acceptTiltIfNeeded(bob, 2)
      await expect(alice.locator('.room-history > div')).toHaveCount(2)
      await expect(bob.locator('.room-history > div')).toHaveCount(2)
      await expect(alice.getByText('轮到你了')).toBeVisible()
      const count = await pool.query<{ count: string }>(
        `
          SELECT count(*)::text AS count
          FROM roll_attempts ra
          JOIN games g ON g.id = ra.game_id
          WHERE g.room_id = $1 AND ra.command_id = $2
        `,
        [firstRoomId, commandId],
      )
      expect(count.rows[0]?.count).toBe('1')
    } finally {
      duplicateSocket.close()
    }

    for (const issues of [aliceIssues, bobIssues, carolIssues, danIssues]) {
      expect(issues.pageErrors, 'uncaught page errors').toEqual([])
      expect(issues.consoleErrors, 'browser console errors').toEqual([])
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})
