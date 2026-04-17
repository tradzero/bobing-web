/**
 * solver A/B sweep
 *
 * 对比 GSSolver 与 SplitSolver 在 box 运行时下的结算表现。
 */
import { runTrial, parseArgs } from './lib/run-trial'

interface Variant {
  label: string
  solverMode: 'gs' | 'split'
  solverIterations: number
}

const DEFAULT_SEEDS = [
  1776401121559,
  1776401998577,
  1776308150130,
  1776308167330,
  1776308075747,
  1776308125213,
  42,
  1,
  7777,
  12345,
  99999,
  314159,
  65535,
  271828,
  2024,
  8888,
]

const VARIANTS: Variant[] = [
  { label: 'gs-i10', solverMode: 'gs', solverIterations: 10 },
  { label: 'gs-i15', solverMode: 'gs', solverIterations: 15 },
  { label: 'split-i10', solverMode: 'split', solverIterations: 10 },
  { label: 'split-i15', solverMode: 'split', solverIterations: 15 },
]

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const args = parseArgs()
const seeds = args['seeds']
  ? args['seeds'].split(',').map(Number)
  : DEFAULT_SEEDS

console.log('╔══════════════════════════════════════════════════╗')
console.log('║           solver A/B sweep                       ║')
console.log('╚══════════════════════════════════════════════════╝')
console.log(`seeds=${seeds.length} (box runtime)\n`)

console.log('variant     | timeout | tilt | avgSettle | maxSettle | >5s | avgBroken | sticky seeds')
console.log('------------|---------|------|-----------|-----------|-----|-----------|-----------------------------')

for (const variant of VARIANTS) {
  const results = seeds.map((seed) => ({
    seed,
    result: runTrial({
      seed,
      shapeMode: 'box',
      solverMode: variant.solverMode,
      solverIterations: variant.solverIterations,
    }),
  }))

  const timeoutCount = results.filter(({ result }) => result.settlePath === 'timeout').length
  const tiltDice = results.reduce((sum, { result }) => sum + result.tiltCount, 0)
  const settleTimes = results.map(({ result }) => result.settleTime)
  const over5 = settleTimes.filter((time) => time > 5).length
  const maxSettle = Math.max(...settleTimes)
  const avgSettle = average(settleTimes)
  const avgBroken = average(results.map(({ result }) => result.stableBrokenCount))
  const stickySeeds = results
    .filter(({ result }) => result.settleTime > 5 || result.stableBrokenCount >= 10)
    .map(({ seed, result }) => `${seed}:${result.settleTime.toFixed(1)}s`)
    .join(' ')

  console.log(
    `${variant.label.padEnd(11)}| ${String(timeoutCount).padStart(3)}/${String(seeds.length).padEnd(3)} | ` +
      `${String(tiltDice).padStart(3)}/${String(seeds.length * 6).padEnd(3)} | ` +
      `${avgSettle.toFixed(2).padStart(8)}s | ${maxSettle.toFixed(2).padStart(8)}s | ` +
      `${String(over5).padStart(3)} | ${avgBroken.toFixed(1).padStart(8)} | ${stickySeeds || '-'}`,
  )
}

console.log('\nwatch seeds: 1776401121559, 1776401998577, 1776308150130, 1776308167330')