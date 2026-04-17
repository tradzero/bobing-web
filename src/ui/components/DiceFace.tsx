const PIP_LAYOUTS: Record<number, string[]> = {
  1: ['center'],
  2: ['tl', 'br'],
  3: ['tl', 'center', 'br'],
  4: ['tl', 'tr', 'bl', 'br'],
  5: ['tl', 'tr', 'center', 'bl', 'br'],
  6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
}

interface DiceFaceProps {
  value: number
  mini?: boolean
}

/** 2D 骰面：用代码生成点位，避免依赖额外图片素材。 */
export function DiceFace({ value, mini = false }: DiceFaceProps) {
  const dots = PIP_LAYOUTS[value] ?? []

  return (
    <span
      className={`dice-pip dice-face ${mini ? 'dice-pip-mini' : ''} ${value === 4 ? 'red' : ''}`}
      aria-label={`骰子点数 ${value}`}
    >
      {dots.map((dot, index) => (
        <span
          key={`${dot}-${index}`}
          className={`dice-dot dice-dot-${dot}`}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}