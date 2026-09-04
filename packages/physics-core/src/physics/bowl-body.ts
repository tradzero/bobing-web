import * as CANNON from 'cannon-es'
import { bowlFloorMaterial, bowlWallMaterial, tableMaterial } from './materials'
import { BOWL_RADIUS, bowlInnerHeight } from '../config/bowl'

// ─── 碗碰撞体参数（导出供测试引用） ───

// 从共享模块 re-export，保持测试导入路径不变
export { BOWL_RADIUS, BOWL_HEIGHT } from '../config/bowl'

/** Heightfield 每边网格点数（51：elementSize≈0.052m，骰子底面覆盖约 4.6~5 格，减少三角面棱线微弹跳） */
export const HF_GRID_SIZE = 51
/** 挡墙片数 */
export const WALL_COUNT = 16
/** 挡墙中心距原点半径 (m)，等比缩放随 BOWL_RADIUS */
export const WALL_RADIUS = 1.03
/** 挡墙高度 (m)，增高防止骰子嵌入碗壁 */
export const WALL_HEIGHT = 0.65
/** 挡墙径向厚度 (m) */
export const WALL_THICKNESS = 0.06
/** 挡墙底部埋入 Heightfield 的深度 (m) */
export const WALL_BURY = 0.05
/** 逃逸高度阈值 (m)：骰子 Y 超过此值时反射速度，防止弹出碗外 */
export const ESCAPE_Y = 0.9

export interface BowlBodies {
  /** 碗底 Heightfield body */
  bottom: CANNON.Body
  /** 挡墙 bodies */
  walls: CANNON.Body[]
  /** 桌面兜底 body */
  table: CANNON.Body
}

/**
 * 碗内壁高度（委托给共享模块 bowlInnerHeight）
 * 保留此导出以兼容测试导入
 */
export const bowlCurveHeight = bowlInnerHeight

/**
 * 生成 Heightfield 高度数据（中心最低，边缘最高）
 * 返回归一化后的数据（碗底中心高度 = 0）及 elementSize 和原始最小高度
 */
export function generateHeightfieldData(): {
  data: number[][]
  elementSize: number
  minHeight: number
} {
  const extent = BOWL_RADIUS * 2
  const elementSize = extent / (HF_GRID_SIZE - 1)
  const center = extent / 2

  let minHeight = Infinity
  const data: number[][] = []

  for (let i = 0; i < HF_GRID_SIZE; i++) {
    const row: number[] = []
    for (let j = 0; j < HF_GRID_SIZE; j++) {
      // 网格点对应的碗中心偏移
      const dx = i * elementSize - center
      const dz = j * elementSize - center
      const d = Math.sqrt(dx * dx + dz * dz)
      const h = bowlCurveHeight(d)
      if (h < minHeight) minHeight = h
      row.push(h)
    }
    data.push(row)
  }

  // 归一化：减去最小高度使碗底中心为 0
  for (let i = 0; i < HF_GRID_SIZE; i++) {
    for (let j = 0; j < HF_GRID_SIZE; j++) {
      data[i][j] -= minHeight
    }
  }

  return { data, elementSize, minHeight }
}

/**
 * 创建碗复合碰撞体
 * Heightfield 连续碗底 + 竖直低矮挡墙 + 桌面兜底
 */
export function createBowlBodies(world: CANNON.World): BowlBodies {
  // ─── 1. Heightfield 碗底（连续曲面，无缝隙） ───
  const { data, elementSize, minHeight } = generateHeightfieldData()
  const hfShape = new CANNON.Heightfield(data, { elementSize })

  const bottom = new CANNON.Body({
    mass: 0,
    material: bowlFloorMaterial,
  })
  bottom.addShape(hfShape)

  // Heightfield 局部：X→worldX, Y→world -Z (经旋转), Z(高度)→worldY
  // 旋转 -π/2 绕 X 轴使高度轴对齐世界 Y
  bottom.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
  // 偏移使碗中心（grid 中心点）对齐世界原点
  bottom.position.set(-BOWL_RADIUS, 0, BOWL_RADIUS)

  world.addBody(bottom)

  // ─── 2. 竖直低矮挡墙（只防逃出，不拟合曲面） ───
  const walls: CANNON.Body[] = []
  // 每面墙切向半宽度（含 15% 重叠余量）
  const wallTangentialHalf = (((2 * Math.PI * WALL_RADIUS) / WALL_COUNT) * 1.15) / 2
  // 挡墙所在半径处的 Heightfield 高度（归一化后）
  const hfEdgeH = bowlCurveHeight(WALL_RADIUS) - minHeight
  // 挡墙中心 Y：底部埋入 Heightfield 以保证过渡无缝隙
  const wallCenterY = hfEdgeH - WALL_BURY + WALL_HEIGHT / 2

  for (let i = 0; i < WALL_COUNT; i++) {
    const angle = (i / WALL_COUNT) * Math.PI * 2
    const x = Math.sin(angle) * WALL_RADIUS
    const z = Math.cos(angle) * WALL_RADIUS

    const wall = new CANNON.Body({
      mass: 0,
      material: bowlWallMaterial,
      position: new CANNON.Vec3(x, wallCenterY, z),
    })

    // Box 半尺寸: X=切向(宽), Y=高度, Z=径向(薄)
    wall.addShape(
      new CANNON.Box(new CANNON.Vec3(wallTangentialHalf, WALL_HEIGHT / 2, WALL_THICKNESS / 2)),
    )

    // 绕 Y 轴旋转使薄轴 (local Z) 指向径向
    wall.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle)

    world.addBody(wall)
    walls.push(wall)
  }

  // ─── 3. 桌面兜底平面 ───
  const table = new CANNON.Body({
    mass: 0,
    material: tableMaterial,
    position: new CANNON.Vec3(0, -0.075, 0),
  })
  table.addShape(new CANNON.Plane())
  table.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
  world.addBody(table)

  return { bottom, walls, table }
}
