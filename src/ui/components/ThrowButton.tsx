import { useGameController } from './GameControllerContext'

export function ThrowButton() {
  const ctrl = useGameController()

  return (
    <button
      onClick={() => ctrl.throw()}
      style={{
        position: 'absolute',
        bottom: 40,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '12px 32px',
        fontSize: '1.2rem',
        fontWeight: 'bold',
        borderRadius: 8,
        border: 'none',
        cursor: 'pointer',
        background: '#e74c3c',
        color: '#fff',
        zIndex: 10,
        minWidth: 44,
        minHeight: 44,
      }}
    >
      掷骰
    </button>
  )
}
