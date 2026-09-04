import type { DicePair } from '@/dice/create'
import { bowlInnerHeight } from '@dice/physics-core/config/bowl'
import { PHYSICS } from '@dice/physics-core/config/physics'
import { syncBodyInterpolationState } from '@dice/physics-core/physics/body-interpolation'

/** 静态首屏/重置时的骰子环半径，六颗之间保留少量间隙。 */
export const REST_RING_RADIUS = 0.3

/** 避免视觉网格与离散 Heightfield 表面出现轻微重叠。 */
const REST_SURFACE_CLEARANCE = 0.003

/**
 * 将全部骰子放回碗底的确定性静态姿态。
 *
 * idle 阶段不再依赖物理循环“把骰子落下来”，因此这里必须一次性同步
 * Cannon 的 raw/previous/interpolated pose，并让刚体休眠。
 */
export function placeDiceAtRest(dicePairs: readonly DicePair[]): void {
  const restHeight =
    bowlInnerHeight(REST_RING_RADIUS) + PHYSICS.diceHalfSize + REST_SURFACE_CLEARANCE

  dicePairs.forEach(({ body }, index) => {
    const angle = (index / dicePairs.length) * Math.PI * 2
    body.position.set(
      Math.cos(angle) * REST_RING_RADIUS,
      restHeight,
      Math.sin(angle) * REST_RING_RADIUS,
    )
    body.quaternion.set(0, 0, 0, 1)
    body.velocity.set(0, 0, 0)
    body.angularVelocity.set(0, 0, 0)
    body.force.set(0, 0, 0)
    body.torque.set(0, 0, 0)
    syncBodyInterpolationState(body)
    body.aabbNeedsUpdate = true
    body.sleep()
  })
}
