/**
 * 碰撞体性能基准：Box(8v/6f) vs Chamfer(24v/14f)
 * 用法: pnpm sweep:bench [--frames=300] [--rounds=3]
 */
import { createPhysicsWorld } from '@/physics/world'
import { createBowlBodies } from '@/physics/bowl-body'
import { setupContactMaterials } from '@/physics/materials'
import { createDiceBody, type ShapeMode } from '@/dice/dice-body'
import { PHYSICS } from '@/config/physics'
import { reseed } from '@/utils/random'
import { throwDice } from '@/dice/throw'
import type { DicePair } from '@/dice/create'
import { DEFAULT_SWEEP_CHAMFER_RATIO, parseArgs } from './lib/run-trial'

const args = parseArgs()
const FRAMES = Number(args['frames'] ?? 300)
const ROUNDS = Number(args['rounds'] ?? 3)
const SEED = 42

function benchRound(shapeMode: ShapeMode, frames: number): number {
  reseed(SEED)
  const { world, step, dispose } = createPhysicsWorld()
  setupContactMaterials(world)
  createBowlBodies(world)

  const dicePairs = Array.from({ length: 6 }, () => {
    const body = createDiceBody(
      shapeMode === 'chamfer'
        ? { shapeMode, chamferRatio: DEFAULT_SWEEP_CHAMFER_RATIO }
        : { shapeMode },
    )
    world.addBody(body)
    return { mesh: {} as DicePair['mesh'], body }
  })
  throwDice(dicePairs)

  const dt = PHYSICS.fixedTimeStep
  const t0 = performance.now()
  for (let i = 0; i < frames; i++) {
    step(dt)
  }
  const elapsed = performance.now() - t0

  dispose()
  return elapsed
}

console.log(`shape-bench: ${FRAMES} 帧 × ${ROUNDS} 轮, seed=${SEED}\n`)

const results: Record<ShapeMode, number[]> = { box: [], chamfer: [] }

for (let r = 0; r < ROUNDS; r++) {
  // 交替执行减少缓存偏差
  for (const mode of ['box', 'chamfer'] as ShapeMode[]) {
    const ms = benchRound(mode, FRAMES)
    results[mode].push(ms)
    console.log(`  第${r + 1}轮 ${mode.padEnd(7)} ${ms.toFixed(1)}ms`)
  }
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const boxMedian = median(results.box)
const chamferMedian = median(results.chamfer)
const ratio = chamferMedian / boxMedian

console.log(`
============================================================
  Box     中位耗时: ${boxMedian.toFixed(1)}ms  (${FRAMES} 帧)
  Chamfer 中位耗时: ${chamferMedian.toFixed(1)}ms  (${FRAMES} 帧)
  倍率: ${ratio.toFixed(2)}x
  ${ratio > 5 ? '⚠️  倍率 >5x，考虑降低 chamferRatio' : '✅ 倍率在可接受范围'}
============================================================`)

process.exit(ratio > 5 ? 1 : 0)
