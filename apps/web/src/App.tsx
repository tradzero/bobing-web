import { lazy, Suspense } from 'react'
import '@/ui/styles/global.css'
import '@/ui/styles/game.css'
import { RoomDirectory } from '@/multiplayer/RoomDirectory'

const SingleplayerApp = lazy(() => import('./SingleplayerApp'))
const MultiplayerApp = lazy(() =>
  import('./multiplayer/MultiplayerApp').then((module) => ({ default: module.MultiplayerApp })),
)

function roomIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/room\/([^/]+)\/?$/)
  if (!match?.[1]) return null
  try {
    const roomId = decodeURIComponent(match[1]).trim()
    return roomId.length >= 1 && roomId.length <= 64 ? roomId : null
  } catch {
    return null
  }
}

export default function App() {
  const multiplayerEnabled =
    import.meta.env.MODE !== 'test' &&
    import.meta.env.MODE !== 'e2e' &&
    import.meta.env.MODE !== 'singleplayer' &&
    import.meta.env.VITE_MULTIPLAYER_ENABLED !== 'false'
  const roomId = multiplayerEnabled ? roomIdFromPath(window.location.pathname) : null
  return (
    <Suspense
      fallback={
        <div className="scene-loading" role="status">
          正在准备博饼…
        </div>
      }
    >
      {multiplayerEnabled ? (
        roomId ? (
          <MultiplayerApp roomId={roomId} />
        ) : (
          <RoomDirectory />
        )
      ) : (
        <SingleplayerApp />
      )}
    </Suspense>
  )
}
