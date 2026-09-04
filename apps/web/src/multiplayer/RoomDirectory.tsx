import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  PLAYER_DISPLAY_NAME_MAX_LENGTH,
  ROOM_DISPLAY_NAME_MAX_LENGTH,
  ROOM_PASSWORD_MAX_LENGTH,
  ROOM_PASSWORD_MIN_LENGTH,
  type CreateRoomResponse,
  type RoomDirectoryEntry,
  type RoomDirectoryResponse,
} from '@dice/protocol'
import { saveRoomSession } from './use-room'
import '@/ui/styles/multiplayer.css'

const PHASE_LABELS: Record<RoomDirectoryEntry['phase'], string> = {
  empty: '等待加入',
  lobby: '等待开局',
  playing: '游戏中',
  'end-decision': '等待结束选择',
  'bonus-round': '加投轮',
  finished: '已结束',
  abandoned: '已废弃',
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown }
    if (typeof body.message === 'string') return body.message
  } catch {
    // 统一回退到状态码，避免错误响应不是 JSON 时再次失败。
  }
  return `房间服务返回 ${response.status}`
}

export function RoomDirectory() {
  const [rooms, setRooms] = useState<RoomDirectoryEntry[]>([])
  const [roomName, setRoomName] = useState('')
  const [creatorName, setCreatorName] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRooms = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/rooms', { signal })
      if (!response.ok) throw new Error(await responseError(response))
      const body = (await response.json()) as RoomDirectoryResponse
      setRooms(body.rooms)
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return
      setError(loadError instanceof Error ? loadError.message : '无法加载房间列表')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void loadRooms(controller.signal)
    return () => controller.abort()
  }, [loadRooms])

  const createRoom = async (event: FormEvent) => {
    event.preventDefault()
    const displayName = roomName.trim()
    const creatorDisplayName = creatorName.trim()
    if (
      !displayName ||
      !creatorDisplayName ||
      creating ||
      (password.length > 0 && password.length < ROOM_PASSWORD_MIN_LENGTH)
    ) {
      return
    }
    setCreating(true)
    setError(null)
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName,
          creatorDisplayName,
          ...(password.length > 0 ? { password } : {}),
        }),
      })
      if (!response.ok) throw new Error(await responseError(response))
      const body = (await response.json()) as CreateRoomResponse
      if (!saveRoomSession(body.roomId, creatorDisplayName, body.resumeToken)) {
        throw new Error('房间已创建，但浏览器无法保存房主身份；请启用站点存储后刷新列表')
      }
      window.location.assign(`/room/${encodeURIComponent(body.roomId)}`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建房间失败')
      setCreating(false)
    }
  }

  return (
    <main className="room-directory">
      <section className="room-directory-shell">
        <header className="room-directory-header">
          <div>
            <small>局域网联机</small>
            <h1>博饼房间</h1>
            <p>创建开放房或密码房，或进入现有房间；每个房间的游戏和奖池互相独立。</p>
          </div>
          <button type="button" disabled={loading} onClick={() => void loadRooms()}>
            {loading ? '加载中…' : '刷新列表'}
          </button>
        </header>

        <form className="room-create-form" onSubmit={createRoom}>
          <div className="room-create-fields">
            <label htmlFor="room-name">
              房间名称
              <input
                id="room-name"
                value={roomName}
                maxLength={ROOM_DISPLAY_NAME_MAX_LENGTH}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder="例如：三楼茶室"
              />
            </label>
            <label htmlFor="creator-name">
              你的昵称
              <input
                id="creator-name"
                value={creatorName}
                maxLength={PLAYER_DISPLAY_NAME_MAX_LENGTH}
                onChange={(event) => setCreatorName(event.target.value)}
                placeholder="例如：阿明"
              />
            </label>
            <label htmlFor="room-password">
              房间密码（可选）
              <input
                id="room-password"
                type="password"
                value={password}
                minLength={ROOM_PASSWORD_MIN_LENGTH}
                maxLength={ROOM_PASSWORD_MAX_LENGTH}
                autoComplete="new-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder={`留空为开放房，至少 ${ROOM_PASSWORD_MIN_LENGTH} 位`}
              />
            </label>
            <button
              disabled={
                creating ||
                !roomName.trim() ||
                !creatorName.trim() ||
                (password.length > 0 && password.length < ROOM_PASSWORD_MIN_LENGTH)
              }
            >
              {creating ? '正在创建…' : '创建并进入'}
            </button>
          </div>
        </form>

        {error && (
          <div className="room-directory-error" role="alert">
            {error}
          </div>
        )}

        <div className="room-directory-list" aria-live="polite">
          {!loading && rooms.length === 0 && <p className="room-directory-empty">还没有房间</p>}
          {rooms.map((room) => (
            <a href={`/room/${encodeURIComponent(room.id)}`} key={room.id}>
              <div>
                <strong>{room.displayName}</strong>
                <small>
                  {room.accessType === 'password' ? '密码房' : '开放房'} ·{' '}
                  {PHASE_LABELS[room.phase]}
                </small>
              </div>
              <span>
                {room.playerCount} 位玩家
                {room.spectatorCount > 0 ? ` · ${room.spectatorCount} 位旁观` : ''}
              </span>
            </a>
          ))}
        </div>
      </section>
    </main>
  )
}
