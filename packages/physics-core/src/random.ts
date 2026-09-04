/**
 * physics-core 可注入随机数源
 * 生产环境使用基于时间戳种子的 mulberry32，测试时可替换为固定种子
 */

export type RandomFn = () => number

/** mulberry32 PRNG，质量足够且轻量 */
export function mulberry32(seed: number): RandomFn {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 从主 seed 派生稳定的 32-bit 子流 seed。
 * salt 由调用方按随机用途固定；新增或调整子流时应由调用方递增自己的 plan 版本。
 */
export function deriveRandomSeed(seed: number, salt: number): number {
  let mixed = (seed | 0) ^ (salt | 0)
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad)
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97)
  return (mixed ^ (mixed >>> 15)) >>> 0
}

/** 创建不影响全局随机源的、可复现的 mulberry32 子流。 */
export function createRandomSubstream(seed: number, salt: number): RandomFn {
  return mulberry32(deriveRandomSeed(seed, salt))
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
