import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { Pool } from 'pg'
import { collectBrowserIssues } from './helpers/diagnostics'
import { prepareDepletedPool } from './helpers/multiplayer-fixtures'

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
const runId = process.env.MULTIPLAYER_E2E_RUN_ID?.trim()
if (!databaseUrl || !runId) throw new Error('整局 E2E 缺少数据库或运行 ID')

const roomName = `整局 E2E ${runId.slice(0, 12)}`
const pool = new Pool({ connectionString: databaseUrl, max: 2 })
let createdRoomId: string | null = null

async function createAndJoin(page: Page, displayName: string): Promise<string> {
  await page.goto('/rooms')
  await page.getByLabel('房间名称').fill(roomName)
  await page.getByLabel('你的昵称').fill(displayName)
  await page.getByRole('button', { name: '创建并进入' }).click()
  await page.waitForURL(/\/room\/[^/]+$/)
  const roomId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '')
  if (!roomId) throw new Error('创建后未进入房间')
  await expect(page.locator('.room-header')).toContainText(displayName)
  return roomId
}

async function join(page: Page, roomId: string, displayName: string): Promise<void> {
  await page.goto(`/room/${encodeURIComponent(roomId)}`)
  await page.getByLabel('玩家昵称').fill(displayName)
  await page.getByRole('button', { name: '加入房间' }).click()
  await expect(page.locator('.room-header')).toContainText(displayName)
}

async function completeVisibleRoll(page: Page, expectedHistoryCount: number): Promise<void> {
  await page.getByRole('button', { name: '投掷六骰' }).click()
  const history = page.locator('.room-history > div')
  const outcome = await Promise.race([
    history
      .nth(expectedHistoryCount - 1)
      .waitFor({ state: 'visible' })
      .then(() => 'settled' as const),
    page
      .getByText('骰子姿态需要确认')
      .waitFor({ state: 'visible' })
      .then(() => 'tilt' as const),
  ])
  if (outcome === 'tilt') {
    await page.getByRole('button', { name: '接受结果' }).click()
    await expect(history).toHaveCount(expectedHistoryCount)
  }
}

test.beforeAll(async () => {
  await pool.query('DELETE FROM rooms WHERE display_name = $1', [roomName])
})

test.afterAll(async () => {
  await pool.query('DELETE FROM rooms WHERE id = $1 OR display_name = $2', [
    createdRoomId,
    roomName,
  ])
  await pool.end()
})

test('奖池耗尽后可立即结束、原阵容再开一局，或每人加投一次', async ({ browser }) => {
  test.setTimeout(240_000)
  const contexts: BrowserContext[] = []
  try {
    const hostContext = await browser.newContext()
    const guestContext = await browser.newContext()
    const spectatorContext = await browser.newContext()
    contexts.push(hostContext, guestContext, spectatorContext)
    const host = await hostContext.newPage()
    const guest = await guestContext.newPage()
    const spectator = await spectatorContext.newPage()
    const hostIssues = collectBrowserIssues(host)
    const guestIssues = collectBrowserIssues(guest)
    const spectatorIssues = collectBrowserIssues(spectator)

    createdRoomId = await createAndJoin(host, '流程房主')
    await join(guest, createdRoomId, '流程玩家')
    await host.getByRole('button', { name: '开始博饼' }).click()

    await completeVisibleRoll(host, 1)
    const firstGameId = await prepareDepletedPool(pool, createdRoomId)
    await expect(guest.getByText('轮到你了')).toBeVisible()
    await completeVisibleRoll(guest, 2)
    await expect(host.getByText('63 份奖项已博完')).toBeVisible()
    await expect(guest.getByText('等待房主选择')).toBeVisible()
    await host.getByRole('button', { name: '立即结束' }).click()
    await expect(host.getByText('本局已结束')).toBeVisible()
    await expect(guest.getByText('本局已结束')).toBeVisible()

    await join(spectator, createdRoomId, '后到旁观者')
    await expect(spectator.locator('.room-player-awards')).not.toContainText('后到旁观者')
    await expect(spectator.getByText('等待房主再开一局')).toBeVisible()

    await host.getByRole('button', { name: '再开一局' }).click()
    await expect(host.getByText('轮到你了')).toBeVisible()
    await expect(host.getByText('2 位玩家已入座')).toHaveCount(0)
    await expect(spectator.getByRole('button', { name: '投掷六骰' })).toHaveCount(0)
    const restarted = await pool.query<{
      game_id: string
      remaining: number
      player_count: number
    }>(
      `
        SELECT g.id AS game_id,
               sum(p.remaining_count)::integer AS remaining,
               (SELECT count(*)::integer FROM game_players gp WHERE gp.game_id = g.id) AS player_count
        FROM games g
        JOIN game_prize_pools p ON p.game_id = g.id
        WHERE g.room_id = $1 AND g.status = 'playing'
        GROUP BY g.id
      `,
      [createdRoomId],
    )
    expect(restarted.rows[0]).toMatchObject({ remaining: 63, player_count: 2 })
    expect(restarted.rows[0]?.game_id).not.toBe(firstGameId)

    await completeVisibleRoll(host, 1)
    const secondGameId = await prepareDepletedPool(pool, createdRoomId)
    expect(secondGameId).toBe(restarted.rows[0]?.game_id)
    await completeVisibleRoll(guest, 2)
    await expect(host.getByText('63 份奖项已博完')).toBeVisible()
    const grantsBeforeBonus = await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM award_grants WHERE game_id = $1',
      [secondGameId],
    )

    await host.getByRole('button', { name: '每人再投一轮' }).click()
    await expect(host.getByText('轮到你了')).toBeVisible()
    await completeVisibleRoll(host, 3)
    await expect(guest.getByText('轮到你了')).toBeVisible()
    await completeVisibleRoll(guest, 4)
    await expect(host.getByText('本局已结束')).toBeVisible()
    await expect(guest.getByText('本局已结束')).toBeVisible()
    await expect(host.locator('.room-zhuangyuan')).toContainText('当前状元')

    const finalState = await pool.query<{
      status: string
      bonus_queue_size: number
      grant_count: number
      bonus_roll_count: number
      invalid_bonus_reason_count: number
      claim_count: number
    }>(
      `
        SELECT g.status,
               cardinality(g.bonus_queue)::integer AS bonus_queue_size,
               (SELECT count(*)::integer FROM award_grants ag WHERE ag.game_id = g.id) AS grant_count,
               (SELECT count(*)::integer FROM roll_attempts r
                WHERE r.game_id = g.id AND r.roll_sequence > 2) AS bonus_roll_count,
               (SELECT count(*)::integer FROM roll_attempts r
                WHERE r.game_id = g.id AND r.roll_sequence > 2
                  AND r.allocation_reason NOT IN ('bonus-no-allocation', 'zhuangyuan-claim'))
                 AS invalid_bonus_reason_count,
               (SELECT count(*)::integer FROM zhuangyuan_claims z
                WHERE z.game_id = g.id) AS claim_count
        FROM games g
        WHERE g.id = $1
      `,
      [secondGameId],
    )
    expect(finalState.rows[0]).toEqual({
      status: 'finished',
      bonus_queue_size: 0,
      grant_count: grantsBeforeBonus.rows[0]?.count ?? -1,
      bonus_roll_count: 2,
      invalid_bonus_reason_count: 0,
      claim_count: expect.any(Number),
    })
    expect(finalState.rows[0]!.claim_count).toBeGreaterThan(0)

    for (const issues of [hostIssues, guestIssues, spectatorIssues]) {
      expect(issues.pageErrors, 'uncaught page errors').toEqual([])
      expect(issues.consoleErrors, 'browser console errors').toEqual([])
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})
