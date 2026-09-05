import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import NodeWebSocket, { type RawData } from 'ws'
import { collectBrowserIssues } from './helpers/diagnostics'

interface SocketServerMessage {
  type: string
  code?: string
  message?: string
}

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
const runId = process.env.MULTIPLAYER_E2E_RUN_ID?.trim()
if (!databaseUrl || !runId) {
  throw new Error('多人 E2E 缺少数据库或运行 ID')
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

async function joinCurrentRoom(page: Page, displayName: string, password?: string): Promise<void> {
  await page.getByLabel('玩家昵称').fill(displayName)
  if (password) await page.getByLabel('房间密码（开放房可留空）').fill(password)
  await page.getByRole('button', { name: '加入房间' }).click()
  await expect(page.locator('.room-header')).toContainText(displayName)
}

async function createAndJoinRoom(
  page: Page,
  roomName: string,
  displayName: string,
  password?: string,
): Promise<string> {
  await page.goto('/rooms')
  await page.getByLabel('房间名称').fill(roomName)
  await page.getByLabel('你的昵称').fill(displayName)
  if (password) await page.getByLabel('房间密码（可选）').fill(password)
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
    // 局域网 HTTP 在部分 Chrome 中没有 randomUUID，Alice 的完整命令链固定走兼容分支。
    await alice.addInitScript(() => {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        configurable: true,
        value: undefined,
      })
    })
    await installWebSocketInterruptionControl(bob)
    const aliceIssues = collectBrowserIssues(alice)
    const bobIssues = collectBrowserIssues(bob)
    const carolIssues = collectBrowserIssues(carol)
    const danIssues = collectBrowserIssues(dan)

    await alice.goto('/')
    await expect(alice.getByRole('heading', { name: '博饼房间' })).toBeVisible()
    await expect(alice.getByRole('button', { name: '创建并进入' })).toBeVisible()
    await expect(alice.getByLabel('玩家昵称')).toHaveCount(0)
    const firstRoomId = await createAndJoinRoom(alice, roomNames[0], 'Alice E2E')
    await enterListedRoom(bob, roomNames[0])
    expect(roomIdFromUrl(bob)).toBe(firstRoomId)
    await joinCurrentRoom(bob, 'Bob E2E')

    const secondRoomPassword = 'e2e-room-secret'
    const secondRoomId = await createAndJoinRoom(
      carol,
      roomNames[1],
      'Carol E2E',
      secondRoomPassword,
    )
    expect(secondRoomId).not.toBe(firstRoomId)
    await dan.goto('/rooms')
    const passwordRoomLink = dan.getByRole('link', { name: new RegExp(roomNames[1]) })
    await expect(passwordRoomLink).toContainText('密码房')
    await passwordRoomLink.click()
    await dan.waitForURL(/\/room\/[^/]+$/)
    expect(roomIdFromUrl(dan)).toBe(secondRoomId)
    await dan.getByLabel('玩家昵称').fill('Dan E2E')
    await dan.getByLabel('房间密码（开放房可留空）').fill('wrong-password')
    await dan.getByRole('button', { name: '加入房间' }).click()
    await expect(dan.getByText('房间密码错误')).toBeVisible()
    await joinCurrentRoom(dan, 'Dan E2E', secondRoomPassword)

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

    const danResumeToken = await readResumeToken(dan, secondRoomId)
    const nonHostSocket = await openPlayerSocket(secondRoomId, 'Dan E2E', danResumeToken)
    try {
      const forbidden = waitForSocketMessage(
        nonHostSocket,
        (message) => message.type === 'error' && message.code === 'forbidden',
      )
      nonHostSocket.send(JSON.stringify({ type: 'close-room', commandId: randomUUID() }))
      await expect(forbidden).resolves.toMatchObject({
        type: 'error',
        code: 'forbidden',
      })
      await expect(carol.locator('.room-header')).toContainText(roomNames[1])
    } finally {
      nonHostSocket.close()
    }

    await expect(dan.getByRole('button', { name: '关闭房间' })).toHaveCount(0)
    await carol.getByRole('button', { name: '关闭房间' }).click()
    await carol.getByRole('button', { name: '确认关闭' }).click()
    await expect(carol.getByRole('heading', { name: '房间已关闭' })).toBeVisible()
    await expect(dan.getByRole('heading', { name: '房间已关闭' })).toBeVisible()
    await expect(carol.getByText('房主已关闭房间')).toBeVisible()

    await alice.goto('/rooms')
    await expect(alice.getByRole('link', { name: new RegExp(roomNames[0]) })).toBeVisible()
    await expect(alice.getByRole('link', { name: new RegExp(roomNames[1]) })).toHaveCount(0)
    const archived = await pool.query<{ archived: boolean }>(
      'SELECT archived_at IS NOT NULL AS archived FROM rooms WHERE id = $1',
      [secondRoomId],
    )
    expect(archived.rows[0]?.archived).toBe(true)

    for (const issues of [aliceIssues, bobIssues, carolIssues, danIssues]) {
      expect(issues.pageErrors, 'uncaught page errors').toEqual([])
      expect(issues.consoleErrors, 'browser console errors').toEqual([])
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})

test('移动端保留奖池、全员获取与最近结果，并向桌面旁观者同步揭晓', async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const roomId = await createAndJoinRoom(page, `${roomNames[0]} 移动端`, 'MobileHost')
  await expect(page.getByRole('navigation', { name: '房间信息' })).toBeVisible()
  await expect(page.locator('.room-award small')).toHaveCount(6)
  await expect(page.locator('.room-award small').first()).toBeVisible()
  const canvas = await page.locator('canvas').boundingBox()
  const action = await page.locator('.room-action-card').boundingBox()
  expect(canvas).not.toBeNull()
  expect(action!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height)
  await page.getByRole('button', { name: '全员获奖' }).click()
  await expect(page.locator('.room-player-awards')).toBeVisible()
  await expect(page.locator('.room-player-awards')).toContainText('MobileHost')
  await expect(page.locator('.room-award-grid')).toBeHidden()
  await page.getByRole('button', { name: '最近结果', exact: true }).click()
  await expect(page.locator('.room-history')).toBeVisible()
  await expect(page.locator('.room-awards')).toBeHidden()
  await page.getByRole('button', { name: '奖池与奖项' }).click()
  await page.getByRole('button', { name: '开始博饼' }).click()
  const spectatorContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  try {
    const spectator = await spectatorContext.newPage()
    await spectator.goto(`/room/${roomId}`)
    await joinCurrentRoom(spectator, '看客')
    await page.getByRole('button', { name: '投掷六骰', exact: true }).click()
    await expect
      .poll(async () => {
        const result = await pool.query(
          'SELECT count(*)::int AS count FROM roll_attempts a JOIN games g ON g.id = a.game_id WHERE g.room_id = $1',
          [roomId],
        )
        return result.rows[0].count as number
      })
      .toBeGreaterThan(0)
    await page.getByRole('button', { name: '最近结果', exact: true }).click()
    await acceptTiltIfNeeded(page)
    await expect(page.locator('.result-announcement')).toBeVisible()
    await expect(page.locator('.result-announcement-player')).toContainText('MobileHost')
    await expect(spectator.locator('.result-announcement')).toBeVisible()
    await expect(spectator.locator('.result-announcement-player')).toContainText('MobileHost')
    expect(await spectator.locator('.result-announcement').innerText()).toBe(
      await page.locator('.result-announcement').innerText(),
    )
    for (const client of [page, spectator]) {
      await client.locator('.result-announcement').evaluate(async (element) => {
        await Promise.all(
          element.getAnimations({ subtree: true }).map((animation) => animation.finished),
        )
      })
    }
    const announcement = await page.locator('.result-announcement').boundingBox()
    const nextAction = await page.locator('.room-action-card').boundingBox()
    const settledCanvas = await page.locator('canvas').boundingBox()
    expect(announcement!.y).toBeGreaterThanOrEqual(settledCanvas!.y + settledCanvas!.height)
    expect(announcement!.y + announcement!.height).toBeLessThanOrEqual(nextAction!.y)
    await page.screenshot({ path: 'artifacts/multiplayer-mobile.png', fullPage: true })
    await spectator.screenshot({
      path: 'artifacts/result-announcement-multiplayer-desktop.png',
      fullPage: true,
    })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.getByRole('button', { name: '投掷六骰', exact: true })).toBeVisible()
    expect((await page.locator('.room-action-card').boundingBox())!.height).toBeLessThan(100)
    await page.screenshot({
      path: 'artifacts/result-announcement-multiplayer-host.png',
      fullPage: true,
    })
  } finally {
    await spectatorContext.close()
  }
})
