import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  type ActiveRollSnapshot,
  type ClientMessage,
  type RoomSnapshot,
  type ServerMessage,
} from '@dice/protocol'

type ConnectionStatus = 'idle' | 'connecting' | 'joined' | 'disconnected' | 'error'

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

const ROOM_ID = import.meta.env.VITE_DEFAULT_ROOM_ID?.trim() || 'default'
const STORAGE_KEY = `dice-room:${ROOM_ID}:session-v1`

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

function loadSession(): { displayName: string; resumeToken: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed.displayName !== 'string' || typeof parsed.resumeToken !== 'string')
      return null
    return { displayName: parsed.displayName, resumeToken: parsed.resumeToken }
  } catch {
    return null
  }
}

function saveSession(displayName: string, resumeToken: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ displayName, resumeToken }))
}

const INITIAL_STATE: MultiplayerRoomState = {
  status: 'idle',
  playerId: null,
  snapshot: null,
  activeRoll: null,
  error: null,
  pendingCommand: null,
}

export function useMultiplayerRoom() {
  const socketRef = useRef<WebSocket | null>(null)
  const nameRef = useRef<string>('')
  const [state, setState] = useState<MultiplayerRoomState>(INITIAL_STATE)

  const connect = useCallback((rawDisplayName: string, resumeToken?: string) => {
    const displayName = rawDisplayName.trim()
    if (!displayName) {
      setState((current) => ({ ...current, status: 'error', error: '请输入昵称' }))
      return
    }
    socketRef.current?.close()
    nameRef.current = displayName
    setState({ ...INITIAL_STATE, status: 'connecting' })
    const socket = new WebSocket(socketUrl())
    socketRef.current = socket
    socket.addEventListener('open', () => {
      const message: ClientMessage = {
        type: 'join-room',
        protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
        roomId: ROOM_ID,
        displayName,
        ...(resumeToken ? { resumeToken } : {}),
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
        saveSession(displayName, message.resumeToken)
        setState({
          status: 'joined',
          playerId: message.playerId,
          snapshot: message.snapshot,
          activeRoll: message.snapshot.activeRoll,
          error: null,
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
        if (resumeToken && message.code === 'not-found') localStorage.removeItem(STORAGE_KEY)
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
    })
    socket.addEventListener('error', () => {
      setState((current) => ({ ...current, error: '无法连接房间服务' }))
    })
  }, [])

  useEffect(() => {
    const session = loadSession()
    let active = true
    if (session) {
      queueMicrotask(() => {
        if (active) connect(session.displayName, session.resumeToken)
      })
    }
    return () => {
      active = false
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [connect])

  const sendCommand = useCallback((message: RoomCommand) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    const command = { ...message, commandId: crypto.randomUUID() } as ClientMessage
    socket.send(JSON.stringify(command))
    setState((current) => ({ ...current, pendingCommand: command.type, error: null }))
    return true
  }, [])

  const reconnect = useCallback(() => {
    const session = loadSession()
    connect(session?.displayName || nameRef.current, session?.resumeToken)
  }, [connect])

  return {
    state,
    connect,
    reconnect,
    sendCommand,
    storedDisplayName: loadSession()?.displayName ?? '',
  }
}
