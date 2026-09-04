import { loadServerConfig } from '../config/env'
import { loadProjectEnvFile } from '../config/load-env'
import { createDatabasePool } from '../db/pool'
import { RoomRepository } from './repository'
import {
  parseRoomResetCliOptions,
  resolveRoomResetTarget,
  roomResetCliUsage,
} from './reset-cli-options'

loadProjectEnvFile()

async function main(): Promise<void> {
  const options = parseRoomResetCliOptions(process.argv.slice(2))
  if (options.help) {
    console.log(roomResetCliUsage())
    return
  }

  const config = loadServerConfig()
  const roomId = resolveRoomResetTarget(options, config.defaultRoomId)

  const pool = createDatabasePool(config)
  try {
    const result = await new RoomRepository(pool).forceResetRoom(roomId)
    console.log(
      `[room-reset] room=${result.roomId} deletedGames=${result.deletedGameCount} deletedMembers=${result.deletedMemberCount}`,
    )
    console.log('[room-reset] 完成；现在可以重新启动服务，并让所有玩家刷新后自动重新绑定')
  } finally {
    await pool.end()
  }
}

void main().catch((error: unknown) => {
  console.error(`[room-reset] ${error instanceof Error ? error.message : '未知错误'}`)
  process.exitCode = 1
})
