import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  parseCreateOpenRoomRequest,
  type CreateOpenRoomResponse,
  type RoomDirectoryResponse,
} from '@dice/protocol'
import type { RoomRepository } from './repository'

const MAX_CREATE_ROOM_BODY_BYTES = 4 * 1024

class HttpInputError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpInputError'
    this.status = status
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(body))
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new HttpInputError(415, 'Content-Type 必须是 application/json')
  }

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_CREATE_ROOM_BODY_BYTES) {
      throw new HttpInputError(413, '创建房间请求体过大')
    }
    chunks.push(buffer)
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpInputError(400, '请求体必须是合法 JSON')
  }
}

export async function handleRoomHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  repository: RoomRepository,
): Promise<boolean> {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  if (pathname !== '/api/rooms') return false

  try {
    if (request.method === 'GET') {
      const body: RoomDirectoryResponse = { rooms: await repository.listOpenRooms() }
      sendJson(response, 200, body)
      return true
    }

    if (request.method === 'POST') {
      const input = parseCreateOpenRoomRequest(await readJsonBody(request))
      const created = await repository.createOpenRoomWithHost(input)
      const body: CreateOpenRoomResponse = {
        roomId: created.room.id,
        resumeToken: created.resumeToken,
      }
      response.setHeader('location', `/room/${encodeURIComponent(body.roomId)}`)
      sendJson(response, 201, body)
      return true
    }

    response.setHeader('allow', 'GET, POST')
    sendJson(response, 405, { error: 'method-not-allowed' })
    return true
  } catch (error) {
    if (
      error instanceof HttpInputError ||
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      sendJson(response, error instanceof HttpInputError ? error.status : 400, {
        error: 'invalid-request',
        message: error instanceof Error ? error.message : '创建房间请求不合法',
      })
      return true
    }
    throw error
  }
}
