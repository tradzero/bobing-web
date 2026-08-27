import * as CANNON from 'cannon-es'
import { PHYSICS } from '@/config/physics'
import { diceMaterial } from '@/physics/materials'
import { createChamferedCubeHull } from './chamfer'

/** 碰撞体形状模式 */
export type ShapeMode = 'box' | 'chamfer'

/** createDiceBody 可选参数，支持测试中参数化对比 */
export interface DiceBodyOptions {
  halfSize?: number
  shapeMode?: ShapeMode
  chamferRatio?: number
}

/**
 * 面法线常量（本地坐标）
 * 用于点数读取：与世界 up 向量点积最大的面即为朝上面
 * value 对应骰子点数，标准骰子对面之和为 7
 */
export const FACE_NORMALS: { normal: CANNON.Vec3; value: number }[] = [
  { normal: new CANNON.Vec3(1, 0, 0), value: 2 }, // +x
  { normal: new CANNON.Vec3(-1, 0, 0), value: 5 }, // -x
  { normal: new CANNON.Vec3(0, 1, 0), value: 1 }, // +y
  { normal: new CANNON.Vec3(0, -1, 0), value: 6 }, // -y
  { normal: new CANNON.Vec3(0, 0, 1), value: 3 }, // +z
  { normal: new CANNON.Vec3(0, 0, -1), value: 4 }, // -z
]

/**
 * 创建单颗骰子物理 body（physics-only，零渲染依赖）
 * 默认使用 PHYSICS 全局配置，测试可通过 opts 覆盖
 */
export function createDiceBody(opts?: DiceBodyOptions): CANNON.Body {
  const hs = opts?.halfSize ?? PHYSICS.diceHalfSize
  const chamferRatio = opts?.chamferRatio ?? PHYSICS.diceChamferRatio
  // diceChamferRatio > 0 时默认走 chamfer，显式传入 shapeMode 可覆盖
  const _shapeMode = opts?.shapeMode ?? (chamferRatio > 0 ? 'chamfer' : 'box')

  const body = new CANNON.Body({
    mass: PHYSICS.diceMass,
    material: diceMaterial,
    linearDamping: PHYSICS.diceLinearDamping,
    angularDamping: PHYSICS.diceAngularDamping,
    allowSleep: true,
    sleepSpeedLimit: PHYSICS.diceSleepSpeedLimit,
    sleepTimeLimit: PHYSICS.diceSleepTimeLimit,
  })

  if (_shapeMode === 'chamfer') {
    // 截角立方体凸包碰撞体
    const chamfer = hs * chamferRatio
    const { vertices, faces } = createChamferedCubeHull(hs, chamfer)
    const verts = vertices.map((v) => new CANNON.Vec3(v[0], v[1], v[2]))
    body.addShape(new CANNON.ConvexPolyhedron({ vertices: verts, faces }))
  } else {
    body.addShape(new CANNON.Box(new CANNON.Vec3(hs, hs, hs)))
  }

  return body
}
