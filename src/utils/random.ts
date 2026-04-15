/**
 * 可注入随机数源
 * 生产环境使用基于时间戳种子的 mulberry32，测试时可替换为固定种子
 */

export type RandomFn = () => number

/** mulberry32 PRNG，质量足够且轻量 */
function mulberry32(seed: number): RandomFn {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let _seed: number = Date.now()
let _random: RandomFn = mulberry32(_seed)
let _customRandom = false

/** 设置随机数源（用于测试注入） */
export function setRandom(fn: RandomFn): void {
  _random = fn
  _customRandom = true
}

/** 重置为默认种子 PRNG */
export function resetRandom(): void {
  _seed = Date.now()
  _random = mulberry32(_seed)
  _customRandom = false
}

/** 使用新种子重新初始化 PRNG，返回种子值 */
export function reseed(seed?: number): number {
  _seed = seed ?? Date.now()
  _random = mulberry32(_seed)
  _customRandom = false
  return _seed
}

/** 获取当前种子（自定义 random 时返回 -1） */
export function getCurrentSeed(): number {
  return _customRandom ? -1 : _seed
}

/** 获取 [0, 1) 随机数 */
export function random(): number {
  return _random()
}

/** 获取 [min, max) 范围随机数 */
export function randomRange(min: number, max: number): number {
  return min + _random() * (max - min)
}
