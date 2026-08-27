// @vitest-environment node
import { describe, expect, it } from 'vitest'
import * as CANNON from 'cannon-es'
import { ESCAPE_Y } from '@/physics/bowl-body'
import { applyEscapeGuard, ESCAPE_VELOCITY_DAMPING } from '@/physics/escape-guard'

function makeBody(y: number, velocityY: number): CANNON.Body {
  const body = new CANNON.Body({ mass: 1 })
  body.position.y = y
  body.velocity.set(1, velocityY, 2)
  return body
}

describe('逃逸反射保护', () => {
  it('超过阈值且向上运动时只反射纵向速度', () => {
    const body = makeBody(ESCAPE_Y + 0.01, 4)

    expect(applyEscapeGuard(body)).toBe(true)
    expect(body.velocity.x).toBe(1)
    expect(body.velocity.y).toBe(-4 * ESCAPE_VELOCITY_DAMPING)
    expect(body.velocity.z).toBe(2)
  })

  it('位于阈值时不反射', () => {
    const body = makeBody(ESCAPE_Y, 4)

    expect(applyEscapeGuard(body)).toBe(false)
    expect(body.velocity.y).toBe(4)
  })

  it('超过阈值但正在下落时不反射', () => {
    const body = makeBody(ESCAPE_Y + 0.01, -4)

    expect(applyEscapeGuard(body)).toBe(false)
    expect(body.velocity.y).toBe(-4)
  })
})
