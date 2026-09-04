import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { Pool } from 'pg'
import { collectBrowserIssues } from './helpers/diagnostics'

const roomId = process.env.MULTIPLAYER_E2E_ROOM_ID?.trim()
const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
if (!roomId || !databaseUrl) {
  throw new Error('多人 E2E 缺少 MULTIPLAYER_E2E_ROOM_ID 或 TEST_DATABASE_URL')
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 })

async function join(page: Page, displayName: string): Promise<void> {
  await page.goto('/')
  await page.getByLabel('玩家昵称').fill(displayName)
  await page.getByRole('button', { name: '加入房间' }).click()
  await expect(page.locator('.room-header')).toContainText(displayName)
}

async function acceptTiltIfNeeded(page: Page): Promise<void> {
  const history = page.locator('.room-history > div')
  const tilt = page.getByText('骰子姿态需要确认')
  const outcome = await Promise.race([
    history
      .first()
      .waitFor({ state: 'visible' })
      .then(() => 'settled' as const),
    tilt.waitFor({ state: 'visible' }).then(() => 'tilt' as const),
  ])
  if (outcome === 'tilt') {
    await page.getByRole('button', { name: '接受结果' }).click()
    await expect(history).toHaveCount(1)
  }
}

test.beforeAll(async () => {
  await pool.query('DELETE FROM rooms WHERE id = $1', [roomId])
  await pool.query(
    `
      INSERT INTO rooms (id, display_name, access_type)
      VALUES ($1, $2, 'open')
    `,
    [roomId, '多人浏览器 E2E'],
  )
})

test.afterAll(async () => {
  await pool.query('DELETE FROM rooms WHERE id = $1', [roomId])
  await pool.end()
})

test('两个独立浏览器身份完成加入、开局、权威投掷、同步与恢复', async ({ browser }) => {
  let aliceContext: BrowserContext | undefined
  let bobContext: BrowserContext | undefined
  try {
    aliceContext = await browser.newContext()
    bobContext = await browser.newContext()
    const alice = await aliceContext.newPage()
    const bob = await bobContext.newPage()
    const aliceIssues = collectBrowserIssues(alice)
    const bobIssues = collectBrowserIssues(bob)

    await join(alice, 'Alice E2E')
    await expect(alice.getByText('1 位玩家已入座')).toBeVisible()
    await join(bob, 'Bob E2E')

    await expect(alice.getByText('2 位玩家已入座')).toBeVisible()
    await expect(bob.getByText('2 位玩家已入座')).toBeVisible()
    await expect(alice.getByRole('button', { name: '开始博饼' })).toBeVisible()
    await expect(bob.getByRole('button', { name: '开始博饼' })).toHaveCount(0)

    await alice.getByRole('button', { name: '开始博饼' }).click()
    await expect(alice.getByText('轮到你了')).toBeVisible()
    await expect(alice.getByRole('button', { name: '投掷六骰' })).toBeVisible()
    await expect(bob.getByRole('button', { name: '投掷六骰' })).toHaveCount(0)

    await alice.getByRole('button', { name: '投掷六骰' }).click()
    await expect(alice.getByText(/服务端正在计算真实物理|骰子翻滚中/)).toBeVisible()
    await expect(bob.getByText('骰子翻滚中')).toBeVisible()
    await acceptTiltIfNeeded(alice)

    await expect(alice.locator('.room-history > div')).toHaveCount(1)
    await expect(bob.locator('.room-history > div')).toHaveCount(1)
    const aliceRoll = await alice.locator('.room-history > div').first().innerText()
    const bobRoll = await bob.locator('.room-history > div').first().innerText()
    expect(bobRoll).toBe(aliceRoll)
    await expect(alice.locator('.room-player-award-row')).toHaveCount(2)
    await expect(bob.locator('.room-player-award-row')).toHaveCount(2)
    await expect(bob.getByText('轮到你了')).toBeVisible()
    await expect(bob.getByRole('button', { name: '投掷六骰' })).toBeVisible()
    await expect(alice.getByRole('button', { name: '投掷六骰' })).toHaveCount(0)

    await bob.reload()
    await expect(bob.locator('.room-header')).toContainText('Bob E2E')
    await expect(bob.getByRole('button', { name: '加入房间' })).toHaveCount(0)
    await expect(bob.locator('.room-player-award-row')).toHaveCount(2)
    await expect(bob.locator('.room-history > div')).toHaveCount(1)
    await expect(bob.getByRole('button', { name: '投掷六骰' })).toBeVisible()

    expect(aliceIssues.pageErrors, 'Alice uncaught page errors').toEqual([])
    expect(aliceIssues.consoleErrors, 'Alice browser console errors').toEqual([])
    expect(bobIssues.pageErrors, 'Bob uncaught page errors').toEqual([])
    expect(bobIssues.consoleErrors, 'Bob browser console errors').toEqual([])
  } finally {
    await aliceContext?.close()
    await bobContext?.close()
  }
})
