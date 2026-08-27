import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Pool, PoolClient } from 'pg'

const MIGRATION_LOCK_ID = 4_263_678_219

interface AppliedMigration {
  name: string
  checksum: string
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

function checksum(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export async function migrateDatabase(
  pool: Pool,
  migrationsDirectory = path.resolve(process.cwd(), 'apps/server/migrations'),
): Promise<string[]> {
  const client = await pool.connect()
  const appliedNow: string[] = []
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_ID])
    await ensureMigrationTable(client)
    const appliedResult = await client.query<AppliedMigration>(
      'SELECT name, checksum FROM schema_migrations ORDER BY name',
    )
    const applied = new Map(appliedResult.rows.map((migration) => [migration.name, migration]))
    const files = (await readdir(migrationsDirectory))
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort()

    for (const name of files) {
      const sql = await readFile(path.join(migrationsDirectory, name), 'utf8')
      const migrationChecksum = checksum(sql)
      const existing = applied.get(name)
      if (existing) {
        if (existing.checksum !== migrationChecksum) {
          throw new Error(`已应用迁移 ${name} 的校验和已变化，拒绝继续启动`)
        }
        continue
      }

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          name,
          migrationChecksum,
        ])
        await client.query('COMMIT')
        appliedNow.push(name)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
    return appliedNow
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_ID])
      .catch(() => undefined)
    client.release()
  }
}
