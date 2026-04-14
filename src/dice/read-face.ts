import * as CANNON from 'cannon-es'
import { FACE_NORMALS } from './create'

const UP = new CANNON.Vec3(0, 1, 0)
const _worldNormal = new CANNON.Vec3()

/** 详细读面结果：点数 + 可信度 (cos θ) */
export interface FaceReadResult {
  value: number
  /** 最大点积，即 cos(倾斜角)，1.0 = 完全水平，越低越倾斜 */
  confidence: number
}

/**
 * 内部核心：读取单颗骰子朝上面的点数和可信度
 */
function readFaceCore(body: CANNON.Body): FaceReadResult {
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

  return { value, confidence: maxDot }
}

/**
 * 读取单颗骰子朝上面的点数（兼容现有接口）
 */
export function readFace(body: CANNON.Body): number {
  return readFaceCore(body).value
}

/**
 * 读取 6 颗骰子的朝上点数数组（兼容现有接口）
 */
export function readAllFaces(bodies: CANNON.Body[]): number[] {
  return bodies.map(readFace)
}

/**
 * 读取单颗骰子的详细结果（点数 + 可信度）
 */
export function readFaceDetailed(body: CANNON.Body): FaceReadResult {
  return readFaceCore(body)
}

/**
 * 读取全部骰子的详细结果数组
 */
export function readAllFacesDetailed(bodies: CANNON.Body[]): FaceReadResult[] {
  return bodies.map(readFaceCore)
}
