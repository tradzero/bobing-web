import * as CANNON from 'cannon-es'
import { FACE_NORMALS } from './create'

const UP = new CANNON.Vec3(0, 1, 0)
const _worldNormal = new CANNON.Vec3()

/**
 * 读取单颗骰子朝上面的点数
 * 将每个面法线通过骰子四元数旋转到世界坐标，
 * 与世界 up 向量 (0,1,0) 做点积，取最大值对应面
 */
export function readFace(body: CANNON.Body): number {
  let maxDot = -Infinity
  let value = 1

  for (const face of FACE_NORMALS) {
    // 将本地法线旋转到世界坐标
    body.quaternion.vmult(face.normal, _worldNormal)
    const dot = _worldNormal.dot(UP)
    if (dot > maxDot) {
      maxDot = dot
      value = face.value
    }
  }

  return value
}

/**
 * 读取 6 颗骰子的朝上点数数组
 */
export function readAllFaces(bodies: CANNON.Body[]): number[] {
  return bodies.map(readFace)
}
