import * as CANNON from 'cannon-es'
import { PHYSICS } from '@/config/physics'

export interface ContactMaterialTuning {
  friction?: number
  restitution?: number
  contactEquationStiffness?: number
  contactEquationRelaxation?: number
  frictionEquationStiffness?: number
  frictionEquationRelaxation?: number
}

export interface ContactMaterialOverrides {
  diceFloor?: ContactMaterialTuning
  diceWall?: ContactMaterialTuning
  diceDice?: ContactMaterialTuning
  diceTable?: ContactMaterialTuning
}

/** 物理材质实例 */
export const diceMaterial = new CANNON.Material('dice')
/** 碗底 Heightfield 材质（独立于碗壁，便于分别调参） */
export const bowlFloorMaterial = new CANNON.Material('bowlFloor')
/** 碗壁挡墙材质（独立于碗底，便于分别调参） */
export const bowlWallMaterial = new CANNON.Material('bowlWall')
export const tableMaterial = new CANNON.Material('table')

/**
 * 创建所有接触材质对并添加到世界
 */
export function setupContactMaterials(
  world: CANNON.World,
  overrides?: ContactMaterialOverrides,
): void {
  const { diceFloor, diceWall, diceDice, diceTable } = PHYSICS.contact
  const mergedDiceFloor = { ...diceFloor, ...overrides?.diceFloor }
  const mergedDiceWall = { ...diceWall, ...overrides?.diceWall }
  const mergedDiceDice = { ...diceDice, ...overrides?.diceDice }
  const mergedDiceTable = { ...diceTable, ...overrides?.diceTable }

  // 骰子-碗底（Heightfield）
  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMaterial, bowlFloorMaterial, {
      ...mergedDiceFloor,
    }),
  )

  // 骰子-碗壁（挡墙）
  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMaterial, bowlWallMaterial, {
      ...mergedDiceWall,
    }),
  )

  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMaterial, diceMaterial, {
      ...mergedDiceDice,
    }),
  )

  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMaterial, tableMaterial, {
      ...mergedDiceTable,
    }),
  )
}
