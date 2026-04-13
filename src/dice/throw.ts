import type { DicePair } from './create'
import { THROW } from '@/config/throw'
import { random, randomRange } from '@/utils/random'

/**
 * 投掷逻辑：为每颗骰子设置随机初始位置、速度、角速度
 * 骰子从碗上方散布投入
 */
export function throwDice(dicePairs: DicePair[]): void {
  for (const { body } of dicePairs) {
    // 唤醒骰子
    body.wakeUp()

    // 随机初始位置：碗上方散布
    const angle = random() * Math.PI * 2
    const r = random() * THROW.spreadRadius
    const x = Math.cos(angle) * r
    const z = Math.sin(angle) * r
    const y = randomRange(THROW.heightMin, THROW.heightMax)
    body.position.set(x, y, z)

    // 随机初始旋转（均匀分布四元数）
    const u1 = random()
    const u2 = random()
    const u3 = random()
    const sqrt1MinusU1 = Math.sqrt(1 - u1)
    const sqrtU1 = Math.sqrt(u1)
    body.quaternion.set(
      sqrt1MinusU1 * Math.sin(2 * Math.PI * u2),
      sqrt1MinusU1 * Math.cos(2 * Math.PI * u2),
      sqrtU1 * Math.sin(2 * Math.PI * u3),
      sqrtU1 * Math.cos(2 * Math.PI * u3),
    )

    // 受控随机线速度（向碗中心偏移 + 向下）
    const vx = randomRange(THROW.horizontalSpeedMin, THROW.horizontalSpeedMax) - x * 0.5
    const vy = randomRange(THROW.downSpeedMin, THROW.downSpeedMax)
    const vz = randomRange(THROW.horizontalSpeedMin, THROW.horizontalSpeedMax) - z * 0.5
    body.velocity.set(vx, vy, vz)

    // 受控随机角速度
    body.angularVelocity.set(
      randomRange(THROW.angularSpeedMin, THROW.angularSpeedMax),
      randomRange(THROW.angularSpeedMin, THROW.angularSpeedMax),
      randomRange(THROW.angularSpeedMin, THROW.angularSpeedMax),
    )
  }
}
