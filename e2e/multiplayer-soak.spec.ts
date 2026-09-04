import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { Pool } from 'pg'
import { collectBrowserIssues } from './helpers/diagnostics'
import { prepareDepletedPool } from './helpers/multiplayer-fixtures'

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
const runId = process.env.MULTIPLAYER_E2E_RUN_ID?.trim()
if (!databaseUrl || !runId) throw new Error('多人 soak 缺少数据库或运行 ID')

const configuredGames = Number(process.env.MULTIPLAYER_SOAK_GAMES ?? 3)
const configuredRollsPerGame = Number(process.env.MULTIPLAYER_SOAK_ROLLS_PER_GAME ?? 3)
if (!Number.isInteger(configuredGames) || configuredGames < 2 || configuredGames > 10) {
  throw new RangeError('MULTIPLAYER_SOAK_GAMES 必须是 2 到 10 的整数')
}
if (
  !Number.isInteger(configuredRollsPerGame) ||
  configuredRollsPerGame < 1 ||
  configuredRollsPerGame > 20
) {
  throw new RangeError('MULTIPLAYER_SOAK_ROLLS_PER_GAME 必须是 1 到 20 的整数')
}

const roomName = `多人 Soak ${runId.slice(0, 12)}`
const displayNames = ['Soak Alice', 'Soak Bob', 'Soak Carol'] as const
const pool = new Pool({ connectionString: databaseUrl, max: 2 })
let createdRoomId: string | null = null

interface ActiveTurnRow {
  sequence: number
  cycle_number: number
  display_name: string
}

interface GameInvariantRow {
  status: string
  active_turn_count: number
  committed_roll_count: number
  distinct_command_count: number
  minimum_remaining: number
  remaining_total: number
  grant_count: number
  claim_count: number
}

interface GameSummary {
  gameId: string
  endMode: 'deadline' | 'bonus-deadlines'
  regularDeadlineSkips: number
  bonusDeadlineSkips: number
  committedRolls: number
}

async function createAndJoin(page: Page): Promise<string> {
  await page.goto('/rooms')
  await page.getByLabel('房间名称').fill(roomName)
  await page.getByLabel('你的昵称').fill(displayNames[0])
  await page.getByRole('button', { name: '创建并进入' }).click()
  await page.waitForURL(/\/room\/[^/]+$/)
  const roomId = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '')
  if (!roomId) throw new Error('soak 创建后未进入房间')
  return roomId
}

async function join(page: Page, roomId: string, displayName: string): Promise<void> {
  await page.goto(`/room/${encodeURIComponent(roomId)}`)
  await page.getByLabel('玩家昵称').fill(displayName)
  await page.getByRole('button', { name: '加入房间' }).click()
  await expect(page.locator('.room-header')).toContainText(displayName)
}

async function latestPlayingGame(roomId: string): Promise<{
  gameId: string
  remaining: number
}> {
  let current: { gameId: string; remaining: number } | undefined
  await expect
    .poll(async () => {
      const result = await pool.query<{
        game_id: string
        remaining: number
      }>(
        `
          SELECT g.id AS game_id,
                 sum(p.remaining_count)::integer AS remaining
          FROM games g
          JOIN game_prize_pools p ON p.game_id = g.id
          WHERE g.room_id = $1 AND g.status = 'playing'
          GROUP BY g.id, g.created_at
          ORDER BY g.created_at DESC
          LIMIT 1
        `,
        [roomId],
      )
      const row = result.rows[0]
      current = row ? { gameId: row.game_id, remaining: row.remaining } : undefined
      return current?.gameId ?? null
    })
    .not.toBeNull()
  if (!current) throw new Error('没有找到进行中的游戏')
  return current
}

async function getActiveTurn(gameId: string): Promise<ActiveTurnRow | undefined> {
  const result = await pool.query<ActiveTurnRow>(
    `
      SELECT t.sequence, t.cycle_number, m.display_name
      FROM turns t
      JOIN room_members m ON m.id = t.player_id
      WHERE t.game_id = $1
        AND t.status IN ('awaiting-roll', 'rolling', 'tilt-decision')
    `,
    [gameId],
  )
  expect(result.rows.length).toBeLessThanOrEqual(1)
  return result.rows[0]
}

async function committedRollCount(gameId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `
      SELECT count(*)::integer AS count
      FROM roll_attempts
      WHERE game_id = $1 AND status = 'committed'
    `,
    [gameId],
  )
  return result.rows[0]?.count ?? -1
}

async function expectLockedLineup(gameId: string): Promise<void> {
  const result = await pool.query<{ display_name: string; seat: number }>(
    `
      SELECT display_name, seat
      FROM game_players
      WHERE game_id = $1
      ORDER BY seat
    `,
    [gameId],
  )
  expect(result.rows).toEqual(
    displayNames.map((displayName, seat) => ({ display_name: displayName, seat })),
  )
}

async function rollAndWait(page: Page, gameId: string, expectedRollCount: number): Promise<void> {
  await page.getByRole('button', { name: '投掷六骰' }).click()
  const committed = expect
    .poll(() => committedRollCount(gameId), { timeout: 25_000 })
    .toBe(expectedRollCount)
    .then(() => 'committed' as const)
  const outcome = await Promise.race([
    committed,
    page
      .getByText('骰子姿态需要确认')
      .waitFor({ state: 'visible' })
      .then(() => 'tilt' as const),
  ])
  if (outcome === 'tilt') {
    await page.getByRole('button', { name: '接受结果' }).click()
    await expect.poll(() => committedRollCount(gameId), { timeout: 20_000 }).toBe(expectedRollCount)
  }
}

async function readInvariant(gameId: string): Promise<GameInvariantRow> {
  const result = await pool.query<GameInvariantRow>(
    `
      SELECT g.status,
             (SELECT count(*)::integer FROM turns t
              WHERE t.game_id = g.id
                AND t.status IN ('awaiting-roll', 'rolling', 'tilt-decision')) AS active_turn_count,
             (SELECT count(*)::integer FROM roll_attempts r
              WHERE r.game_id = g.id AND r.status = 'committed') AS committed_roll_count,
             (SELECT count(DISTINCT r.command_id)::integer FROM roll_attempts r
              WHERE r.game_id = g.id AND r.status = 'committed') AS distinct_command_count,
             (SELECT min(p.remaining_count)::integer FROM game_prize_pools p
              WHERE p.game_id = g.id) AS minimum_remaining,
             (SELECT sum(p.remaining_count)::integer FROM game_prize_pools p
              WHERE p.game_id = g.id) AS remaining_total,
             (SELECT count(*)::integer FROM award_grants a
              WHERE a.game_id = g.id) AS grant_count,
             (SELECT count(*)::integer FROM zhuangyuan_claims z
              WHERE z.game_id = g.id) AS claim_count
      FROM games g
      WHERE g.id = $1
    `,
    [gameId],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`找不到游戏 ${gameId}`)
  return row
}

async function expectPlayingInvariant(gameId: string, expectedRollCount: number): Promise<void> {
  const row = await readInvariant(gameId)
  expect(row).toMatchObject({
    status: 'playing',
    active_turn_count: 1,
    committed_roll_count: expectedRollCount,
    distinct_command_count: expectedRollCount,
  })
  expect(row.minimum_remaining).toBeGreaterThanOrEqual(0)
  expect(row.remaining_total).toBe(63 - row.grant_count - (row.claim_count > 0 ? 1 : 0))
}

async function waitForRegularDeadlineCycle(gameId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const skipped = await pool.query<{
          sequence: number
          cycle_number: number
          display_name: string
          skip_reason: string
        }>(
          `
            SELECT t.sequence, t.cycle_number, m.display_name, t.skip_reason
            FROM turns t
            JOIN room_members m ON m.id = t.player_id
            WHERE t.game_id = $1 AND t.status = 'skipped'
            ORDER BY t.sequence
          `,
          [gameId],
        )
        return skipped.rows.slice(0, displayNames.length)
      },
      { timeout: 40_000 },
    )
    .toEqual(
      displayNames.map((displayName, index) => ({
        sequence: index + 1,
        cycle_number: 1,
        display_name: displayName,
        skip_reason: 'turn-timeout',
      })),
    )

  const active = await getActiveTurn(gameId)
  expect(active).toEqual({ sequence: 4, cycle_number: 2, display_name: displayNames[0] })
}

async function waitForFinished(gameId: string, timeout: number): Promise<void> {
  await expect.poll(async () => (await readInvariant(gameId)).status, { timeout }).toBe('finished')
}

async function eventCount(gameId: string, eventType: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count FROM game_events WHERE game_id = $1 AND event_type = $2`,
    [gameId, eventType],
  )
  return result.rows[0]?.count ?? -1
}

async function expectFinalInvariant(
  gameId: string,
  expectedRolls: number,
  expectedTimeoutSkips: number,
): Promise<void> {
  const invariant = await readInvariant(gameId)
  expect(invariant).toMatchObject({
    status: 'finished',
    active_turn_count: 0,
    committed_roll_count: expectedRolls,
    distinct_command_count: expectedRolls,
    minimum_remaining: 0,
    remaining_total: 0,
  })
  expect(invariant.claim_count).toBeGreaterThan(0)

  const deadlineSkips = await pool.query<{
    skip_count: number
    distinct_player_count: number
  }>(
    `
      SELECT count(*)::integer AS skip_count,
             count(DISTINCT player_id)::integer AS distinct_player_count
      FROM turns
      WHERE game_id = $1 AND status = 'skipped' AND skip_reason = 'turn-timeout'
    `,
    [gameId],
  )
  expect(deadlineSkips.rows[0]).toEqual({
    skip_count: expectedTimeoutSkips,
    distinct_player_count: displayNames.length,
  })
  expect(await eventCount(gameId, 'turn-timeout')).toBe(expectedTimeoutSkips)
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

test('@multiplayer-soak 三浏览器连续 deadline、真实投掷和多局重开保持一致', async ({
  browser,
}, testInfo) => {
  test.setTimeout(
    Math.max(360_000, configuredGames * ((configuredRollsPerGame + 1) * 25_000 + 45_000)),
  )
  const contexts: BrowserContext[] = []
  const summaries: GameSummary[] = []
  try {
    const pages: Page[] = []
    const issues = []
    for (let index = 0; index < displayNames.length; index++) {
      const context = await browser.newContext()
      contexts.push(context)
      const page = await context.newPage()
      pages.push(page)
      issues.push(collectBrowserIssues(page))
    }

    createdRoomId = await createAndJoin(pages[0])
    await join(pages[1], createdRoomId, displayNames[1])
    await join(pages[2], createdRoomId, displayNames[2])
    await expect(pages[0].getByText('3 位玩家已入座')).toBeVisible()

    const seenGameIds = new Set<string>()
    let reloaded = false
    for (let gameNumber = 1; gameNumber <= configuredGames; gameNumber++) {
      const hostAction = gameNumber === 1 ? '开始博饼' : '再开一局'
      await pages[0].getByRole('button', { name: hostAction }).click()
      await expect(pages[0].getByText('轮到你了')).toBeVisible()

      const game = await latestPlayingGame(createdRoomId)
      expect(game.remaining).toBe(63)
      expect(seenGameIds.has(game.gameId)).toBe(false)
      seenGameIds.add(game.gameId)
      await expectLockedLineup(game.gameId)

      await waitForRegularDeadlineCycle(game.gameId)
      await expect(pages[0].getByText('轮到你了')).toBeVisible()

      for (let rollNumber = 1; rollNumber <= configuredRollsPerGame; rollNumber++) {
        const active = await getActiveTurn(game.gameId)
        expect(active).toBeDefined()
        const playerIndex = displayNames.indexOf(
          active!.display_name as (typeof displayNames)[number],
        )
        expect(playerIndex).toBeGreaterThanOrEqual(0)
        const currentPage = pages[playerIndex]!
        await expect(currentPage.getByText('轮到你了')).toBeVisible()
        await rollAndWait(currentPage, game.gameId, rollNumber)
        await expectPlayingInvariant(game.gameId, rollNumber)

        const visibleHistoryCount = Math.min(rollNumber, 5)
        await Promise.all(
          pages.map((page) =>
            expect(page.locator('.room-history > div')).toHaveCount(visibleHistoryCount),
          ),
        )
        const histories = await Promise.all(
          pages.map((page) => page.locator('.room-history > div').first().innerText()),
        )
        expect(histories[1]).toBe(histories[0])
        expect(histories[2]).toBe(histories[0])
      }

      expect(await prepareDepletedPool(pool, createdRoomId)).toBe(game.gameId)
      const active = await getActiveTurn(game.gameId)
      expect(active).toBeDefined()
      const completingPlayerIndex = displayNames.indexOf(
        active!.display_name as (typeof displayNames)[number],
      )
      expect(completingPlayerIndex).toBeGreaterThanOrEqual(0)
      await rollAndWait(pages[completingPlayerIndex]!, game.gameId, configuredRollsPerGame + 1)
      await expect(pages[0].getByText('63 份奖项已博完')).toBeVisible()

      const bonusDeadlineMode = gameNumber % 2 === 0
      let bonusDeadlineSkips = 0
      if (bonusDeadlineMode) {
        await pages[0].getByRole('button', { name: '每人再投一轮' }).click()
        await expect
          .poll(async () => (await getActiveTurn(game.gameId))?.sequence ?? null)
          .not.toBeNull()
        await waitForFinished(game.gameId, 40_000)
        bonusDeadlineSkips = displayNames.length
        expect(await eventCount(game.gameId, 'end-mode-chosen')).toBe(1)
        expect(await eventCount(game.gameId, 'end-decision-timeout')).toBe(0)

        const bonusAttempts = await pool.query<{ count: number }>(
          `
            SELECT count(*)::integer AS count
            FROM roll_attempts r
            JOIN turns t ON t.id = r.turn_id
            WHERE r.game_id = $1 AND t.sequence > $2
          `,
          [game.gameId, displayNames.length + configuredRollsPerGame + 1],
        )
        expect(bonusAttempts.rows[0]?.count).toBe(0)
      } else {
        await waitForFinished(game.gameId, 12_000)
        expect(await eventCount(game.gameId, 'end-decision-timeout')).toBe(1)
        expect(await eventCount(game.gameId, 'end-mode-chosen')).toBe(0)
      }

      for (const page of pages) {
        await expect(page.getByText('本局已结束')).toBeVisible()
      }
      await expectFinalInvariant(
        game.gameId,
        configuredRollsPerGame + 1,
        displayNames.length + bonusDeadlineSkips,
      )

      // 身份恢复放在已结束、尚未重开的安全窗口中，避免测试自身耗时制造额外 deadline。
      if (!reloaded && gameNumber === Math.ceil(configuredGames / 2)) {
        await pages[1].reload()
        await expect(pages[1].locator('.room-header')).toContainText(displayNames[1])
        await expect(pages[1].getByRole('button', { name: '加入房间' })).toHaveCount(0)
        await expect(pages[1].getByText('本局已结束')).toBeVisible()
        reloaded = true
      }
      summaries.push({
        gameId: game.gameId,
        endMode: bonusDeadlineMode ? 'bonus-deadlines' : 'deadline',
        regularDeadlineSkips: displayNames.length,
        bonusDeadlineSkips,
        committedRolls: configuredRollsPerGame + 1,
      })
    }

    expect(seenGameIds.size).toBe(configuredGames)
    expect(summaries.some((summary) => summary.endMode === 'deadline')).toBe(true)
    expect(summaries.some((summary) => summary.endMode === 'bonus-deadlines')).toBe(true)
    const roomGames = await pool.query<{ status: string }>(
      'SELECT status FROM games WHERE room_id = $1 ORDER BY created_at',
      [createdRoomId],
    )
    expect(roomGames.rows).toHaveLength(configuredGames)
    expect(roomGames.rows.every((game) => game.status === 'finished')).toBe(true)
    await testInfo.attach('multiplayer-soak-summary', {
      body: Buffer.from(JSON.stringify({ roomId: createdRoomId, games: summaries }, null, 2)),
      contentType: 'application/json',
    })

    for (const browserIssues of issues) {
      expect(browserIssues.pageErrors, 'uncaught page errors').toEqual([])
      expect(browserIssues.consoleErrors, 'browser console errors').toEqual([])
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()))
  }
})
