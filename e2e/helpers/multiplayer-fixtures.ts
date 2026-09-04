import type { Pool } from 'pg'

/**
 * 整局流程仍需通过真实服务端投掷进入结束分支，但自然博完 63 份不适合作为每次 E2E 的前置。
 * 夹具把当局最后一次已提交投掷规整为合法状元并耗尽奖池；后续投掷、结束选择和重开
 * 仍完整经过生产事务与 WebSocket 链路。
 */
export async function prepareDepletedPool(pool: Pool, roomId: string): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const latest = await client.query<{ game_id: string; roll_id: string; player_id: string }>(
      `
        SELECT g.id AS game_id, r.id AS roll_id, r.player_id
        FROM games g
        JOIN roll_attempts r ON r.game_id = g.id AND r.status = 'committed'
        WHERE g.room_id = $1 AND g.status = 'playing'
        ORDER BY r.roll_sequence DESC
        LIMIT 1
        FOR UPDATE OF g, r
      `,
      [roomId],
    )
    const row = latest.rows[0]
    if (!row) throw new Error('奖池夹具需要至少一次已提交投掷')

    const diceValues = [4, 4, 4, 4, 4, 4]
    const result = {
      prize: 'mantanghong',
      priority: 2,
      carryScore: 0,
      matchedDice: diceValues,
      remainDice: [],
      description: '满堂红',
    }
    await client.query('DELETE FROM award_grants WHERE roll_id = $1', [row.roll_id])
    await client.query('DELETE FROM zhuangyuan_claims WHERE game_id = $1', [row.game_id])
    await client.query(
      `
        UPDATE roll_attempts
        SET dice_values = $2::smallint[],
            judge_result = $3::jsonb,
            award_tier = 'zhuangyuan',
            allocation_reason = 'zhuangyuan-claim'
        WHERE id = $1
      `,
      [row.roll_id, diceValues, JSON.stringify(result)],
    )
    await client.query(
      `
        INSERT INTO zhuangyuan_claims (
          game_id, player_id, roll_id, claim_sequence, dice_values, judge_result
        ) VALUES ($1, $2, $3, 1, $4::smallint[], $5::jsonb)
      `,
      [row.game_id, row.player_id, row.roll_id, diceValues, JSON.stringify(result)],
    )
    await client.query('UPDATE game_prize_pools SET remaining_count = 0 WHERE game_id = $1', [
      row.game_id,
    ])
    await client.query('COMMIT')
    return row.game_id
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
