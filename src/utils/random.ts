/**
 * 可注入随机数源
 * 生产环境使用 Math.random，测试时可替换为固定种子
 */

export type RandomFn = () => number

let _random: RandomFn = Math.random

/** 设置随机数源（用于测试注入） */
export function setRandom(fn: RandomFn): void {
  _random = fn
}

/** 重置为默认 Math.random */
export function resetRandom(): void {
  _random = Math.random
}

/** 获取 [0, 1) 随机数 */
export function random(): number {
  return _random()
}

/** 获取 [min, max) 范围随机数 */
export function randomRange(min: number, max: number): number {
  return min + _random() * (max - min)
}
