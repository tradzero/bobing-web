import { Pool } from 'pg'
import type { ServerConfig } from '../config/env'

export function createDatabasePool(config: Pick<ServerConfig, 'databaseUrl' | 'dbPoolMax'>): Pool {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    application_name: 'dice-multiplayer',
  })
  pool.on('error', (error) => {
    console.error('[database] idle client error', error)
  })
  return pool
}
