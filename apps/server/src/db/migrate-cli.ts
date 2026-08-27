import { loadServerConfig } from '../config/env'
import { migrateDatabase } from './migrate'
import { createDatabasePool } from './pool'

const config = loadServerConfig()
const pool = createDatabasePool(config)

try {
  const applied = await migrateDatabase(pool)
  if (applied.length === 0) console.log('[database] schema already up to date')
  else console.log('[database] applied migrations', applied)
} finally {
  await pool.end()
}
