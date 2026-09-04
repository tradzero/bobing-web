// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMultiplayerRoom } from './use-room'

const STORAGE_KEY = 'dice-room:default:session-v1'

type SocketListener = EventListenerOrEventListenerObject

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []

  readonly sent: string[] = []
  readonly url: string
  readyState = 0
  private readonly listeners = new Map<string, SocketListener[]>()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatch('close', new Event('close'))
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.dispatch('open', new Event('open'))
  }

  receive(message: unknown): void {
    this.dispatch('message', new MessageEvent('message', { data: JSON.stringify(message) }))
  }

  private dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
  }
}

function joinedMessage(resumeToken: string) {
  return {
    type: 'joined',
    protocolVersion: 1,
    playerId: 'player-1',
    resumeToken,
    snapshot: { activeRoll: null },
  }
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('多人浏览器身份绑定', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    localStorage.clear()
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('页面重新挂载时使用保存的恢复令牌自动加入', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ displayName: 'Alice', resumeToken: 'resume-token-1' }),
    )
    const hook = renderHook(() => useMultiplayerRoom())
    await flushMicrotasks()

    const socket = FakeWebSocket.instances[0]
    expect(socket?.url).toBe('ws://localhost:3000/ws')
    act(() => socket?.open())
    expect(JSON.parse(socket?.sent[0] ?? '{}')).toMatchObject({
      type: 'join-room',
      roomId: 'default',
      displayName: 'Alice',
      resumeToken: 'resume-token-1',
    })

    act(() => socket?.receive(joinedMessage('resume-token-2')))
    expect(hook.result.current.state).toMatchObject({ status: 'joined', playerId: 'player-1' })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      displayName: 'Alice',
      resumeToken: 'resume-token-2',
    })

    hook.unmount()
  })

  it('强制清房导致旧令牌失效时保留昵称并自动重新绑定', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ displayName: 'Alice', resumeToken: 'expired-token' }),
    )
    const hook = renderHook(() => useMultiplayerRoom())
    await flushMicrotasks()

    const expiredSocket = FakeWebSocket.instances[0]
    act(() => {
      expiredSocket?.open()
      expiredSocket?.receive({ type: 'error', code: 'not-found', message: '恢复凭据已失效' })
    })
    await flushMicrotasks()

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      displayName: 'Alice',
    })
    const reboundSocket = FakeWebSocket.instances[1]
    act(() => reboundSocket?.open())
    expect(JSON.parse(reboundSocket?.sent[0] ?? '{}')).toMatchObject({
      type: 'join-room',
      displayName: 'Alice',
    })
    expect(JSON.parse(reboundSocket?.sent[0] ?? '{}')).not.toHaveProperty('resumeToken')

    act(() => reboundSocket?.receive(joinedMessage('replacement-token')))
    expect(hook.result.current.state.status).toBe('joined')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      displayName: 'Alice',
      resumeToken: 'replacement-token',
    })

    hook.unmount()
  })

  it('服务断开后自动使用当前绑定重连', async () => {
    const hook = renderHook(() => useMultiplayerRoom())
    act(() => hook.result.current.connect('Alice'))
    const firstSocket = FakeWebSocket.instances[0]
    act(() => {
      firstSocket?.open()
      firstSocket?.receive(joinedMessage('stable-token'))
      firstSocket?.close()
    })
    expect(hook.result.current.state.status).toBe('disconnected')

    act(() => vi.advanceTimersByTime(1_500))
    const reconnectSocket = FakeWebSocket.instances[1]
    act(() => reconnectSocket?.open())
    expect(JSON.parse(reconnectSocket?.sent[0] ?? '{}')).toMatchObject({
      displayName: 'Alice',
      resumeToken: 'stable-token',
    })

    hook.unmount()
  })

  it('加入后定期发送在线心跳，但不把心跳伪装成游戏命令', async () => {
    const hook = renderHook(() => useMultiplayerRoom())
    act(() => hook.result.current.connect('Alice'))
    const socket = FakeWebSocket.instances[0]
    act(() => {
      socket?.open()
      socket?.receive(joinedMessage('stable-token'))
    })

    act(() => vi.advanceTimersByTime(20_000))
    expect(JSON.parse(socket?.sent[1] ?? '{}')).toMatchObject({ type: 'ping' })
    expect(JSON.parse(socket?.sent[1] ?? '{}')).not.toHaveProperty('commandId')

    hook.unmount()
  })

  it('为每个动态房间分别保存身份与恢复令牌', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ displayName: 'Default Alice', resumeToken: 'default-token' }),
    )
    const secondRoomKey = 'dice-room:room-b:session-v1'
    localStorage.setItem(
      secondRoomKey,
      JSON.stringify({ displayName: 'Room Bob', resumeToken: 'room-b-token' }),
    )

    const hook = renderHook(() => useMultiplayerRoom('room-b'))
    await flushMicrotasks()
    const socket = FakeWebSocket.instances[0]
    act(() => socket?.open())
    expect(JSON.parse(socket?.sent[0] ?? '{}')).toMatchObject({
      type: 'join-room',
      roomId: 'room-b',
      displayName: 'Room Bob',
      resumeToken: 'room-b-token',
    })

    act(() => socket?.receive(joinedMessage('room-b-replacement-token')))
    expect(JSON.parse(localStorage.getItem(secondRoomKey) ?? '{}')).toEqual({
      displayName: 'Room Bob',
      resumeToken: 'room-b-replacement-token',
    })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      displayName: 'Default Alice',
      resumeToken: 'default-token',
    })

    hook.unmount()
  })
})
