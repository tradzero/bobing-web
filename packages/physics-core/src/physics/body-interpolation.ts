import type * as CANNON from 'cannon-es'

/** 刚体 teleport 后同步 Cannon 的历史与插值姿态，避免下一帧从旧 pose 插值。 */
export function syncBodyInterpolationState(body: CANNON.Body): void {
  body.previousPosition.copy(body.position)
  body.interpolatedPosition.copy(body.position)
  body.previousQuaternion.copy(body.quaternion)
  body.interpolatedQuaternion.copy(body.quaternion)
}

/** 只写 Cannon 的 interpolated 字段，不改变 raw 物理真值或历史姿态。 */
export function interpolateBodyTransform(body: CANNON.Body, alpha: number): void {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new RangeError('interpolation alpha must be a finite number between 0 and 1')
  }

  body.previousPosition.lerp(body.position, alpha, body.interpolatedPosition)
  body.previousQuaternion.slerp(body.quaternion, alpha, body.interpolatedQuaternion)
  body.interpolatedQuaternion.normalize()
}
