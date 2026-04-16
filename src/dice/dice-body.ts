import * as CANNON from 'cannon-es'
import { PHYSICS } from '@/config/physics'
import { diceMaterial } from '@/physics/materials'

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
  const _shapeMode = opts?.shapeMode ?? 'box'
  // chamferRatio 预留给 Step 2，当前未使用
  // const chamferRatio = opts?.chamferRatio ?? PHYSICS.diceChamferRatio ?? 0

  const body = new CANNON.Body({
    mass: PHYSICS.diceMass,
    material: diceMaterial,
    linearDamping: PHYSICS.diceLinearDamping,
    angularDamping: PHYSICS.diceAngularDamping,
    allowSleep: true,
    sleepSpeedLimit: PHYSICS.diceSleepSpeedLimit,
    sleepTimeLimit: PHYSICS.diceSleepTimeLimit,
  })

  // 当前仅支持 box，chamfer 分支在 Step 2 实现
  if (_shapeMode === 'box') {
    body.addShape(new CANNON.Box(new CANNON.Vec3(hs, hs, hs)))
  } else {
    throw new Error(`shapeMode '${_shapeMode}' is not implemented yet (Step 2)`)
  }

  return body
}
