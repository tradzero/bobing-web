import * as CANNON from 'cannon-es'
import { bowlMaterial, tableMaterial } from './materials'

/**
 * 碗碰撞体参数
 * 碗底 + 环形倾斜碗壁片段 + 桌面兜底
 */
const BOWL_RADIUS = 1.2
const BOWL_HEIGHT = 0.7
const BOWL_BOTTOM_RADIUS = 0.4
const WALL_COUNT = 12
const WALL_THICKNESS = 0.08

export interface BowlBodies {
  /** 碗底 body */
  bottom: CANNON.Body
  /** 碗壁片段 bodies */
  walls: CANNON.Body[]
  /** 桌面兜底 body */
  table: CANNON.Body
}

/**
 * 创建碗复合碰撞体
 * 采用静态复合碰撞体近似，不使用 Trimesh
 */
export function createBowlBodies(world: CANNON.World): BowlBodies {
  // 碗底：扁平圆柱体
  const bottom = new CANNON.Body({
    mass: 0,
    material: bowlMaterial,
    position: new CANNON.Vec3(0, 0.02, 0),
  })
  bottom.addShape(
    new CANNON.Cylinder(BOWL_BOTTOM_RADIUS, BOWL_BOTTOM_RADIUS, 0.04, 16),
  )
  world.addBody(bottom)

  // 碗壁：环形排列的倾斜薄 Box 片段
  const walls: CANNON.Body[] = []
  const wallHeight = BOWL_HEIGHT * 0.9
  const wallWidth = (2 * Math.PI * BOWL_RADIUS) / WALL_COUNT * 1.15 // 略有重叠

  for (let i = 0; i < WALL_COUNT; i++) {
    const angle = (i / WALL_COUNT) * Math.PI * 2
    // 碗壁向内倾斜约 25 度
    const tiltAngle = Math.PI / 7

    const wall = new CANNON.Body({
      mass: 0,
      material: bowlMaterial,
    })

    wall.addShape(
      new CANNON.Box(
        new CANNON.Vec3(wallWidth / 2, wallHeight / 2, WALL_THICKNESS / 2),
      ),
    )

    // 碗壁位置：在碗口边缘，中心高度
    const midRadius = (BOWL_RADIUS + BOWL_BOTTOM_RADIUS) / 2
    const x = Math.sin(angle) * midRadius
    const z = Math.cos(angle) * midRadius
    const y = wallHeight / 2 + 0.02

    wall.position.set(x, y, z)

    // 先绕 Y 轴旋转对准径向，再绕切线方向倾斜
    const qY = new CANNON.Quaternion()
    qY.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -angle)
    const qTilt = new CANNON.Quaternion()
    qTilt.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), tiltAngle)
    wall.quaternion = qY.mult(qTilt)

    world.addBody(wall)
    walls.push(wall)
  }

  // 桌面兜底平面
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
