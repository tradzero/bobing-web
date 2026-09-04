import { WebSocket, type RawData } from 'ws'
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  parseClientMessage,
  serializeServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '@dice/protocol'
import type { ServerConfig } from '../config/env'
import { RoomRollService } from '../roll/service'
import { RoomRepository, RoomRepositoryError, type StartedRoll } from './repository'

interface SocketSession {
  roomId: string
  playerId: string
}

export class RoomHub {
  private readonly repository: RoomRepository
  private readonly rollService: RoomRollService
  private readonly config: ServerConfig
  private readonly sessions = new Map<WebSocket, SocketSession>()

  constructor(repository: RoomRepository, rollService: RoomRollService, config: ServerConfig) {
    this.repository = repository
    this.rollService = rollService
    this.config = config
  }

  attach(socket: WebSocket): void {
    socket.on('message', (data, isBinary) => {
      void this.handleRawMessage(socket, data, isBinary)
    })
    socket.once('close', () => {
      const session = this.sessions.get(socket)
      this.sessions.delete(socket)
      if (session) void this.broadcastRoom(session.roomId)
    })
  }

  async broadcastRoom(roomId: string): Promise<void> {
    const recipients = [...this.sessions.entries()].filter(
      ([, session]) => session.roomId === roomId,
    )
    if (recipients.length === 0) return
    const connectedPlayerIds = new Set(recipients.map(([, session]) => session.playerId))
    const snapshot = await this.repository.getRoomSnapshot(roomId, connectedPlayerIds)
    const message = serializeServerMessage({ type: 'snapshot', snapshot })
    for (const [socket] of recipients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message)
    }
  }

  private broadcastMessage(roomId: string, message: ServerMessage): void {
    const serialized = serializeServerMessage(message)
    for (const [socket, session] of this.sessions) {
      if (session.roomId === roomId && socket.readyState === WebSocket.OPEN) {
        socket.send(serialized)
      }
    }
  }

  broadcastStartedRoll(roomId: string, started: StartedRoll): void {
    this.broadcastMessage(roomId, {
      type: 'roll-started',
      rollId: started.rollId,
      playerId: started.playerId,
      seed: started.seed,
      revealAt: new Date(started.revealAt).toISOString(),
      throwAlgorithmVersion: started.throwAlgorithmVersion,
      settleAlgorithmVersion: started.settleAlgorithmVersion,
    })
  }

  archiveRoom(roomId: string): void {
    for (const [socket, session] of this.sessions) {
      if (session.roomId !== roomId) continue
      this.send(socket, {
        type: 'error',
        code: 'not-found',
        message: '房间长期闲置，已归档',
      })
      this.sessions.delete(socket)
      socket.close(4001, 'room archived')
    }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(serializeServerMessage(message))
  }

  private async handleRawMessage(
    socket: WebSocket,
    data: RawData,
    isBinary: boolean,
  ): Promise<void> {
    if (isBinary) {
      this.send(socket, {
        type: 'error',
        code: 'invalid-message',
        message: '不接受二进制 WebSocket 消息',
      })
      return
    }

    let message: ClientMessage
    try {
      message = parseClientMessage(data.toString('utf8'))
    } catch (error) {
      this.send(socket, {
        type: 'error',
        code:
          error instanceof RangeError && /协议版本/.test(error.message)
            ? 'protocol-mismatch'
            : 'invalid-message',
        message: error instanceof Error ? error.message : '无法解析消息',
      })
      return
    }

    try {
      await this.handleMessage(socket, message)
    } catch (error) {
      const commandId = 'commandId' in message ? message.commandId : undefined
      if (error instanceof RoomRepositoryError) {
        this.send(socket, { type: 'error', code: error.code, message: error.message, commandId })
        return
      }
      console.error('[room] command failed', error)
      this.send(socket, {
        type: 'error',
        code: 'internal-error',
        message: '房间命令执行失败',
        commandId,
      })
    }
  }

  private async handleMessage(socket: WebSocket, message: ClientMessage): Promise<void> {
    if (message.type === 'ping') {
      const session = this.sessions.get(socket)
      if (session) {
        await this.repository.recordPresence(session.roomId, session.playerId)
      }
      this.send(socket, {
        type: 'pong',
        clientTime: message.clientTime,
        serverTime: new Date().toISOString(),
      })
      return
    }

    if (message.type === 'join-room') {
      if (this.sessions.has(socket)) {
        throw new RoomRepositoryError('conflict', '当前连接已经加入房间')
      }
      const joined = await this.repository.joinRoom({
        roomId: message.roomId,
        displayName: message.displayName,
        resumeToken: message.resumeToken,
        maxPlayers: this.config.maxRoomPlayers,
      })
      this.sessions.set(socket, { roomId: message.roomId, playerId: joined.playerId })
      const snapshot = await this.repository.getRoomSnapshot(
        message.roomId,
        this.connectedPlayerIds(message.roomId),
      )
      this.send(socket, {
        type: 'joined',
        protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
        playerId: joined.playerId,
        resumeToken: joined.resumeToken,
        snapshot,
      })
      await this.broadcastRoom(message.roomId)
      return
    }

    const session = this.sessions.get(socket)
    if (!session) {
      this.send(socket, { type: 'error', code: 'not-joined', message: '请先加入房间' })
      return
    }

    if (message.type === 'start-game') {
      await this.repository.startGame({
        roomId: session.roomId,
        playerId: session.playerId,
        now: Date.now(),
        timing: this.config.timing,
      })
      await this.broadcastRoom(session.roomId)
      return
    }

    if (message.type === 'request-roll') {
      const started = await this.rollService.requestRoll({
        roomId: session.roomId,
        playerId: session.playerId,
        commandId: message.commandId,
      })
      if (started) {
        this.broadcastStartedRoll(session.roomId, started)
      }
      await this.broadcastRoom(session.roomId)
      return
    }

    if (message.type === 'tilt-decision') {
      const started = await this.rollService.resolveTiltDecision({
        roomId: session.roomId,
        playerId: session.playerId,
        decision: message.decision,
      })
      if (started) {
        this.broadcastStartedRoll(session.roomId, started)
      }
      await this.broadcastRoom(session.roomId)
      return
    }

    if (message.type === 'choose-end') {
      await this.repository.chooseEndMode({
        roomId: session.roomId,
        playerId: session.playerId,
        mode: message.mode,
        now: Date.now(),
        timing: this.config.timing,
      })
      await this.broadcastRoom(session.roomId)
      return
    }
  }

  private connectedPlayerIds(roomId: string): Set<string> {
    return new Set(
      [...this.sessions.values()]
        .filter((session) => session.roomId === roomId)
        .map((session) => session.playerId),
    )
  }
}
