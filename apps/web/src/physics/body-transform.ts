import type * as CANNON from 'cannon-es'
import type * as THREE from 'three'

export { interpolateBodyTransform, syncBodyInterpolationState } from './body-interpolation'

/** body → 渲染对象时使用的变换来源。 */
export type BodyTransformMode = 'raw' | 'interpolated'

/** 渲染同步只依赖 Object3D 的位置与四元数。 */
type TransformObject = Pick<THREE.Object3D, 'position' | 'quaternion'>

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
