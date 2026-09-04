import type * as CANNON from 'cannon-es'
import { ESCAPE_Y } from './bowl-body'

/** seed 复现记录使用；改变逃逸介入语义时必须递增。 */
export const ESCAPE_GUARD_VERSION = 1

/** 逃逸反射后的纵向速度衰减倍率。 */
export const ESCAPE_VELOCITY_DAMPING = 0.3

/**
 * 对单颗骰子应用现有逃逸反射保护。
 *
 * 该函数只机械封装原 engine 行为：超过高度阈值且仍向上运动时，
 * 反转纵向速度并衰减；不修改位置或水平速度。
 *
 * @returns 本次是否应用了反射
 */
export function applyEscapeGuard(body: Pick<CANNON.Body, 'position' | 'velocity'>): boolean {
  if (body.position.y <= ESCAPE_Y || body.velocity.y <= 0) return false

  body.velocity.y = -body.velocity.y * ESCAPE_VELOCITY_DAMPING
  return true
}
