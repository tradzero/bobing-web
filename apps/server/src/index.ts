import { createServer, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import sirv from 'sirv'
import { WebSocketServer } from 'ws'
import { loadServerConfig } from './config/env'
import { loadProjectEnvFile } from './config/load-env'
import { migrateDatabase } from './db/migrate'
import { createDatabasePool } from './db/pool'
import { RoomHub } from './room/hub'
import { RoomRepository } from './room/repository'
import { RoomRollService } from './roll/service'
import { RoomDeadlineScheduler } from './scheduler/deadlines'

loadProjectEnvFile()

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

async function main(): Promise<void> {
  const config = loadServerConfig()
  const pool = createDatabasePool(config)
  const repository = new RoomRepository(pool)
  if (config.autoMigrate) await migrateDatabase(pool)
  await repository.ensureOpenRoom(config.defaultRoomId)

  const staticFiles = sirv(path.resolve(process.cwd(), 'dist'), {
    dev: false,
    single: true,
    etag: true,
  })
  const server = createServer((request, response) => {
    if (request.url === '/healthz') {
      sendJson(response, 200, { status: 'ok' })
      return
    }
    if (request.url === '/readyz') {
      void repository
        .ping()
        .then(() => sendJson(response, 200, { status: 'ready' }))
        .catch(() => sendJson(response, 503, { status: 'not-ready' }))
      return
    }
    staticFiles(request, response, () => sendJson(response, 404, { error: 'not-found' }))
  })

  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })
  const rollService = new RoomRollService(repository, config)
  const roomHub = new RoomHub(repository, rollService, config)
  const deadlineScheduler = new RoomDeadlineScheduler({
    repository,
    timing: config.timing,
    pollIntervalMs: config.schedulerPollIntervalMs,
    onAutoRoll: async ({ roomId, playerId }) => {
      const started = await rollService.requestRoll({
        roomId,
        playerId,
        commandId: randomUUID(),
      })
      if (started) roomHub.broadcastStartedRoll(roomId, started)
    },
    onRoomsChanged: async (roomIds) => {
      for (const roomId of roomIds) await roomHub.broadcastRoom(roomId)
    },
  })
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname !== '/ws') {
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, (webSocket) =>
      sockets.emit('connection', webSocket),
    )
  })
  sockets.on('connection', (socket) => roomHub.attach(socket))

  const shutdown = () => {
    deadlineScheduler.stop()
    sockets.close()
    server.close(() => {
      void pool.end().finally(() => process.exit(0))
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  deadlineScheduler.start()
  server.listen(config.port, config.host, () => {
    console.log(`[server] http://${config.host}:${config.port} room=${config.defaultRoomId}`)
  })
}

void main().catch((error) => {
  console.error('[server] fatal startup error', error)
  process.exitCode = 1
})
