import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useGameStore } from './GameStoreContext'

type SheetState = 'peek' | 'expanded' | 'hidden'

const MOBILE_QUERY = '(max-width: 768px)'
const DRAG_THRESHOLD = 56
const DRAG_THRESHOLD_FAR = 160

interface MobileBottomSheetProps {
  children: ReactNode
}

function nextSheetState(startState: SheetState, deltaY: number): SheetState {
  if (startState === 'hidden') {
    if (deltaY <= -DRAG_THRESHOLD_FAR) return 'expanded'
    if (deltaY <= -DRAG_THRESHOLD) return 'peek'
    return 'hidden'
  }

  if (startState === 'peek') {
    if (deltaY <= -DRAG_THRESHOLD) return 'expanded'
    if (deltaY >= DRAG_THRESHOLD) return 'hidden'
    return 'peek'
  }

  if (deltaY >= DRAG_THRESHOLD_FAR) return 'hidden'
  if (deltaY >= DRAG_THRESHOLD) return 'peek'
  return 'expanded'
}

function clampDrag(startState: SheetState, deltaY: number): number {
  if (startState === 'hidden') {
    return Math.max(-360, Math.min(deltaY, 24))
  }
  if (startState === 'peek') {
    return Math.max(-240, Math.min(deltaY, 240))
  }
  return Math.max(-24, Math.min(deltaY, 320))
}

/**
 * 移动端底部浮板：
 * - 仅承载 UI 展示顺序和手势开合，不写入游戏 store
 * - rolling 时自动下沉，result / tilt-confirm 时自动回到 peek
 */
export function MobileBottomSheet({ children }: MobileBottomSheetProps) {
  const phase = useGameStore((s) => s.phase)
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(MOBILE_QUERY).matches
  })
  const [sheetState, setSheetState] = useState<SheetState>('peek')
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  const startYRef = useRef<number | null>(null)
  const startStateRef = useRef<SheetState>('peek')
  const activePointerIdRef = useRef<number | null>(null)
  const didDragRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const media = window.matchMedia(MOBILE_QUERY)
    const sync = () => setIsMobile(media.matches)
    sync()

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', sync)
      return () => media.removeEventListener('change', sync)
    }

    media.addListener(sync)
    return () => media.removeListener(sync)
  }, [])

  useEffect(() => {
    if (!isMobile) {
      setSheetState('peek')
      setDragOffset(0)
      setIsDragging(false)
      return
    }

    if (phase === 'result' || phase === 'tilt-confirm') {
      setSheetState((current) => (current === 'expanded' ? current : 'peek'))
    }
  }, [isMobile, phase])

  const finishDrag = (pointerId: number, currentY: number) => {
    if (activePointerIdRef.current !== pointerId || startYRef.current === null) return

    const deltaY = currentY - startYRef.current
    setSheetState(nextSheetState(startStateRef.current, deltaY))
    setDragOffset(0)
    setIsDragging(false)
    startYRef.current = null
    activePointerIdRef.current = null
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!isMobile) return

    activePointerIdRef.current = event.pointerId
    startYRef.current = event.clientY
    startStateRef.current = sheetState
    didDragRef.current = false
    setDragOffset(0)
    setIsDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (activePointerIdRef.current !== event.pointerId || startYRef.current === null) return

    const deltaY = event.clientY - startYRef.current
    if (Math.abs(deltaY) > 6) {
      didDragRef.current = true
    }
    setDragOffset(clampDrag(startStateRef.current, deltaY))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finishDrag(event.pointerId, event.clientY)
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    finishDrag(event.pointerId, event.clientY)
  }

  const handleHandleClick = () => {
    if (!isMobile) return
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }

    setSheetState((current) => {
      if (current === 'hidden') return 'peek'
      if (current === 'peek') return 'expanded'
      return 'hidden'
    })
  }

  const hasLivePanel = phase === 'result' || phase === 'tilt-confirm'
  if (!hasLivePanel) return null

  const handleLabel = sheetState === 'expanded'
    ? '下滑收起结算面板'
    : '上滑查看本轮结算'

  const sheetStyle = isMobile
    ? {
        '--mobile-sheet-drag-offset': `${dragOffset}px`,
        '--mobile-sheet-peek-height': '264px',
      } as CSSProperties
    : undefined

  return (
    <div
      className={`mobile-sheet mobile-sheet-${sheetState} ${isDragging ? 'is-dragging' : ''}`}
      data-state={sheetState}
      style={sheetStyle}
    >
      <button
        type="button"
        className="mobile-sheet-handle"
        aria-expanded={sheetState === 'expanded'}
        aria-label={handleLabel}
        onClick={handleHandleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <span className="mobile-sheet-grip" aria-hidden="true" />
        <span className="mobile-sheet-label">{handleLabel}</span>
      </button>
      <div className="mobile-sheet-viewport">
        <div className="mobile-sheet-content">{children}</div>
      </div>
    </div>
  )
}