/**
 * contact-equation 候选点扩大样本验证
 *
 * 对 baseline 与细扫胜出区间做更大样本对比，确认是否值得进入运行时候选。
 */
import { CONTACT_EQUATION_BASELINE } from './lib/contact-equation-baseline'
import { runTrial, parseArgs } from './lib/run-trial'

interface Variant {
  label: string
  diceDiceContactEquationStiffness?: number
  diceDiceContactEquationRelaxation?: number
}

const WATCH_SEEDS = [1776401121559, 1776401998577, 1776308150130, 1776308167330]
const DEFAULT_BASE_SEED = 50000
const DEFAULT_COUNT = 120
const DEFAULT_STEP = 1000

const VARIANTS: Variant[] = [
  {
    label: 'baseline',
    diceDiceContactEquationStiffness: CONTACT_EQUATION_BASELINE.diceDiceContactEquationStiffness,
    diceDiceContactEquationRelaxation: CONTACT_EQUATION_BASELINE.diceDiceContactEquationRelaxation,
  },
  { label: 's=8e6 r=6', diceDiceContactEquationStiffness: 8e6, diceDiceContactEquationRelaxation: 6 },
  { label: 's=6e6 r=6', diceDiceContactEquationStiffness: 6e6, diceDiceContactEquationRelaxation: 6 },
]

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const args = parseArgs()
const baseSeed = Number(args['base'] ?? DEFAULT_BASE_SEED)
const count = Number(args['count'] ?? DEFAULT_COUNT)
const step = Number(args['step'] ?? DEFAULT_STEP)
const generatedSeeds = Array.from({ length: count }, (_, index) => baseSeed + index * step)
const seeds = [...WATCH_SEEDS, ...generatedSeeds]

console.log('╔══════════════════════════════════════════════════╗')
console.log('║    contact-equation candidate validation         ║')
console.log('╚══════════════════════════════════════════════════╝')
console.log(`watch=${WATCH_SEEDS.length}, generated=${generatedSeeds.length}, total=${seeds.length}\n`)

console.log('variant     | timeout | tilt | avgSettle | p95     | maxSettle | >4s | avgBroken')
console.log('------------|---------|------|-----------|---------|-----------|-----|-----------')

for (const variant of VARIANTS) {
  const results = seeds.map((seed) =>
    runTrial({
      seed,
      shapeMode: 'box',
      diceDiceContactEquationStiffness: variant.diceDiceContactEquationStiffness,
      diceDiceContactEquationRelaxation: variant.diceDiceContactEquationRelaxation,
    }),
  )

  const settleTimes = results.map((result) => result.settleTime).sort((a, b) => a - b)
  const timeoutCount = results.filter((result) => result.settlePath === 'timeout').length
  const tiltDice = results.reduce((sum, result) => sum + result.tiltCount, 0)
  const avgSettle = average(settleTimes)
  const p95 = settleTimes[Math.floor(seeds.length * 0.95)]
  const maxSettle = settleTimes[settleTimes.length - 1]
  const over4 = settleTimes.filter((time) => time > 4).length
  const avgBroken = average(results.map((result) => result.stableBrokenCount))

  console.log(
    `${variant.label.padEnd(11)} | ${String(timeoutCount).padStart(3)}/${String(seeds.length).padEnd(3)} | ` +
      `${String(tiltDice).padStart(3)}/${String(seeds.length * 6).padEnd(3)} | ` +
      `${avgSettle.toFixed(2).padStart(8)}s | ${p95.toFixed(2).padStart(6)}s | ${maxSettle.toFixed(2).padStart(8)}s | ` +
      `${String(over4).padStart(3)} | ${avgBroken.toFixed(1).padStart(8)}`,
  )
}

console.log('\nwatch seeds are always included first.')