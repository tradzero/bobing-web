import type * as CANNON from 'cannon-es'
import type * as THREE from 'three'

/** body → 渲染对象时使用的变换来源。 */
export type BodyTransformMode = 'raw' | 'interpolated'

/** 渲染同步只依赖 Object3D 的位置与四元数。 */
type TransformObject = Pick<THREE.Object3D, 'position' | 'quaternion'>

/**
 * 刚体发生 teleport 后，将 Cannon 的历史与插值姿态同步到当前姿态。
 * 避免下一渲染帧从 teleport 前的 pose 插值，产生拖影或瞬移回弹。
 */
export function syncBodyInterpolationState(body: CANNON.Body): void {
  body.previousPosition.copy(body.position)
  body.interpolatedPosition.copy(body.position)
  body.previousQuaternion.copy(body.quaternion)
  body.interpolatedQuaternion.copy(body.quaternion)
}

/**
 * 以只读 previous/raw pose 计算渲染插值姿态。
 * 结果只写入 Cannon 的 interpolated 字段，不改变物理真值或历史姿态。
 */
export function interpolateBodyTransform(body: CANNON.Body, alpha: number): void {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new RangeError('interpolation alpha must be a finite number between 0 and 1')
  }

  body.previousPosition.lerp(body.position, alpha, body.interpolatedPosition)
  body.previousQuaternion.slerp(body.quaternion, alpha, body.interpolatedQuaternion)
  body.interpolatedQuaternion.normalize()
}

/** 将刚体的原始或插值姿态复制到 Three.js 渲染对象。 */
export function copyBodyTransformToObject(
  body: CANNON.Body,
  object: TransformObject,
  mode: BodyTransformMode,
): void {
  const position = mode === 'interpolated' ? body.interpolatedPosition : body.position
  const quaternion = mode === 'interpolated' ? body.interpolatedQuaternion : body.quaternion

  object.position.set(position.x, position.y, position.z)
  object.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w)
}
