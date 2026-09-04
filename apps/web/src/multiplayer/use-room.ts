import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  PLAYER_DISPLAY_NAME_MAX_LENGTH,
  type ActiveRollSnapshot,
  type ClientMessage,
  type RoomSnapshot,
  type ServerMessage,
} from '@dice/protocol'

type ConnectionStatus = 'idle' | 'connecting' | 'joined' | 'disconnected' | 'error' | 'closed'

export interface MultiplayerRoomState {
  status: ConnectionStatus
  playerId: string | null
  snapshot: RoomSnapshot | null
  activeRoll: ActiveRollSnapshot | null
  error: string | null
  pendingCommand: ClientMessage['type'] | null
}

export type RoomCommand =
  | { type: 'start-game' }
  | { type: 'request-roll' }
  | { type: 'tilt-decision'; decision: 'accept' | 'retry' }
  | { type: 'choose-end'; mode: 'immediate' | 'bonus-round' }
  | { type: 'close-room' }

const RECONNECT_DELAY_MS = 1_500
const PRESENCE_HEARTBEAT_MS = 20_000

function sessionStorageKey(roomId: string): string {
  return `dice-room:${roomId}:session-v1`
}

function clearRoomSession(roomId: string): void {
  const key = sessionStorageKey(roomId)
  try {
    localStorage.removeItem(key)
  } catch {
    // 受限存储环境仍继续清理当前标签页凭据。
  }
  try {
    sessionStorage.removeItem(key)
  } catch {
    // 两种存储都不可用时，当前内存状态仍会终止重连。
  }
}

function createCommandId(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()

  const bytes = new Uint8Array(16)
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

interface StoredIdentity {
  displayName: string
  resumeToken?: string
}

function loadSession(roomId: string): StoredIdentity | null {
  try {
    const key = sessionStorageKey(roomId)
    const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.displayName !== 'string') return null
    const displayName = parsed.displayName.trim()
    if (displayName.length < 1 || displayName.length > PLAYER_DISPLAY_NAME_MAX_LENGTH) return null
    if (
      parsed.resumeToken !== undefined &&
      (typeof parsed.resumeToken !== 'string' ||
        parsed.resumeToken.length < 1 ||
        parsed.resumeToken.length > 256)
    ) {
      return null
    }
    return {
      displayName,
      ...(typeof parsed.resumeToken === 'string' ? { resumeToken: parsed.resumeToken } : {}),
    }
  } catch {
    return null
  }
}

export function saveRoomSession(
  roomId: string,
  displayName: string,
  resumeToken?: string,
): boolean {
  const key = sessionStorageKey(roomId)
  const value = JSON.stringify({ displayName, ...(resumeToken ? { resumeToken } : {}) })
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    try {
      sessionStorage.setItem(key, value)
      return true
    } catch {
      return false
    }
  }
}

const INITIAL_STATE: MultiplayerRoomState = {
  status: 'idle',
  playerId: null,
  snapshot: null,
  activeRoll: null,
  error: null,
  pendingCommand: null,
}

export function useMultiplayerRoom(roomId = 'default') {
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const connectRef = useRef<(displayName: string, resumeToken?: string, password?: string) => void>(
    () => undefined,
  )
  const nameRef = useRef<string>('')
  const [state, setState] = useState<MultiplayerRoomState>(INITIAL_STATE)

  const connect = useCallback(
    (rawDisplayName: string, resumeToken?: string, password?: string) => {
      const displayName = rawDisplayName.trim()
      if (!displayName) {
        setState((current) => ({ ...current, status: 'error', error: '请输入昵称' }))
        return
      }
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      socketRef.current?.close()
      nameRef.current = displayName
      const identitySaved = saveRoomSession(roomId, displayName, resumeToken)
      setState((current) =>
        current.playerId
          ? {
              ...current,
              status: 'connecting',
              error: identitySaved ? null : '浏览器无法保存身份，关闭页面后需要重新输入昵称',
              pendingCommand: null,
            }
          : {
              ...INITIAL_STATE,
              status: 'connecting',
              error: identitySaved ? null : '浏览器无法保存身份，关闭页面后需要重新输入昵称',
            },
      )
      const socket = new WebSocket(socketUrl())
      socketRef.current = socket
      let joined = false
      let retryingWithoutToken = false
      socket.addEventListener('open', () => {
        const message: ClientMessage = {
          type: 'join-room',
          protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
          roomId,
          displayName,
          ...(resumeToken ? { resumeToken } : {}),
          ...(!resumeToken && password ? { password } : {}),
        }
        socket.send(JSON.stringify(message))
      })
      socket.addEventListener('message', (event) => {
        let message: ServerMessage
        try {
          message = JSON.parse(String(event.data)) as ServerMessage
        } catch {
          setState((current) => ({ ...current, status: 'error', error: '服务端消息格式错误' }))
          return
        }
        if (message.type === 'joined') {
          joined = true
          const saved = saveRoomSession(roomId, displayName, message.resumeToken)
          setState({
            status: 'joined',
            playerId: message.playerId,
            snapshot: message.snapshot,
            activeRoll: message.snapshot.activeRoll,
            error: saved ? null : '浏览器无法保存身份，关闭页面后需要重新输入昵称',
            pendingCommand: null,
          })
          return
        }
        if (message.type === 'snapshot') {
          setState((current) => ({
            ...current,
            status: 'joined',
            snapshot: message.snapshot,
            activeRoll: message.snapshot.activeRoll,
            pendingCommand: null,
          }))
          return
        }
        if (message.type === 'roll-started') {
          setState((current) => ({
            ...current,
            activeRoll: {
              id: message.rollId,
              playerId: message.playerId,
              seed: message.seed,
              revealAt: message.revealAt,
              throwAlgorithmVersion: message.throwAlgorithmVersion,
              settleAlgorithmVersion: message.settleAlgorithmVersion,
            },
            pendingCommand: null,
          }))
          return
        }
        if (message.type === 'error') {
          if (message.code === 'room-closed') {
            clearRoomSession(roomId)
            socketRef.current = null
            socket.close()
            setState({ ...INITIAL_STATE, status: 'closed', error: message.message })
            return
          }
          if (!joined && resumeToken && message.code === 'not-found' && !retryingWithoutToken) {
            retryingWithoutToken = true
            saveRoomSession(roomId, displayName)
            setState({ ...INITIAL_STATE, status: 'connecting' })
            queueMicrotask(() => {
              if (socketRef.current === socket) connectRef.current(displayName)
            })
            return
          }
          if (!joined && message.code === 'not-found') {
            setState({
              ...INITIAL_STATE,
              status: 'error',
              error: message.message,
            })
            return
          }
          setState((current) => ({
            ...current,
            status: current.playerId ? current.status : 'error',
            error: message.message,
            pendingCommand: null,
          }))
        }
      })
      socket.addEventListener('close', () => {
        if (socketRef.current !== socket) return
        setState((current) => ({
          ...current,
          status: current.playerId
            ? 'disconnected'
            : current.status === 'error'
              ? 'error'
              : 'disconnected',
          pendingCommand: null,
        }))
        const session = loadSession(roomId)
        if (session) {
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null
            if (socketRef.current === socket) {
              connectRef.current(session.displayName, session.resumeToken)
            }
          }, RECONNECT_DELAY_MS)
        }
      })
      socket.addEventListener('error', () => {
        setState((current) => ({ ...current, error: '无法连接房间服务' }))
      })
    },
    [roomId],
  )
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    if (state.status !== 'joined') return
    const timer = window.setInterval(() => {
      const socket = socketRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN) return
      socket.send(
        JSON.stringify({
          type: 'ping',
          clientTime: new Date().toISOString(),
        } satisfies ClientMessage),
      )
    }, PRESENCE_HEARTBEAT_MS)
    return () => window.clearInterval(timer)
  }, [state.status])

  useEffect(() => {
    const session = loadSession(roomId)
    let active = true
    if (session) {
      queueMicrotask(() => {
        if (active) connect(session.displayName, session.resumeToken)
      })
    }
    return () => {
      active = false
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      const socket = socketRef.current
      socketRef.current = null
      socket?.close()
    }
  }, [connect, roomId])

  const sendCommand = useCallback((message: RoomCommand) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    const command = { ...message, commandId: createCommandId() } as ClientMessage
    socket.send(JSON.stringify(command))
    setState((current) => ({ ...current, pendingCommand: command.type, error: null }))
    return true
  }, [])

  const reconnect = useCallback(() => {
    const session = loadSession(roomId)
    connect(session?.displayName || nameRef.current, session?.resumeToken)
  }, [connect, roomId])

  const join = useCallback(
    (displayName: string, password?: string) => connect(displayName, undefined, password),
    [connect],
  )

  return {
    state,
    join,
    reconnect,
    sendCommand,
    storedDisplayName: loadSession(roomId)?.displayName ?? '',
  }
}
