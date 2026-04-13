import * as CANNON from 'cannon-es'
import { PHYSICS } from '@/config/physics'

/** 物理材质实例 */
export const diceMaterial = new CANNON.Material('dice')
export const bowlMaterial = new CANNON.Material('bowl')
export const tableMaterial = new CANNON.Material('table')

/**
 * 创建所有接触材质对并添加到世界
 */
export function setupContactMaterials(world: CANNON.World): void {
  const { diceBowl, diceDice, diceTable } = PHYSICS.contact

  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMaterial, bowlMaterial, {
      friction: diceBowl.friction,
      restitution: diceBowl.restitution,
    }),
  )

  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMaterial, diceMaterial, {
      friction: diceDice.friction,
      restitution: diceDice.restitution,
    }),
  )

  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMaterial, tableMaterial, {
      friction: diceTable.friction,
      restitution: diceTable.restitution,
    }),
  )
}
