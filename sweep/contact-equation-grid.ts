/**
 * dice-dice contact-equation 细粒度 2D sweep
 *
 * 仅扫描 contactEquationStiffness / contactEquationRelaxation，
 * friction equation 维持运行时默认值，避免把 tilt 风险混进来。
 */
import { CONTACT_EQUATION_BASELINE } from './lib/contact-equation-baseline'
import { runTrial, parseArgs } from './lib/run-trial'

interface ResultRow {
  label: string
  stiffness?: number
  relaxation?: number
  timeoutCount: number
  tiltDice: number
  avgSettle: number
  maxSettle: number
  over4s: number
  avgBroken: number
  stickySeeds: string[]
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

const DEFAULT_STIFFNESS_VALUES = [8e6, 7e6, 6e6, 5e6, 4e6, 3e6]
const DEFAULT_RELAXATION_VALUES = [4, 5, 6]

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function parseNumberList(raw: string | undefined, fallback: number[]): number[] {
  return raw ? raw.split(',').map(Number).filter((value) => Number.isFinite(value)) : fallback
}

function buildRows(seeds: number[], stiffnessValues: number[], relaxationValues: number[]): ResultRow[] {
  const rows: ResultRow[] = []

  const variants = [
    {
      label: 'baseline',
      stiffness: CONTACT_EQUATION_BASELINE.diceDiceContactEquationStiffness,
      relaxation: CONTACT_EQUATION_BASELINE.diceDiceContactEquationRelaxation,
    },
    ...stiffnessValues.flatMap((stiffness) =>
      relaxationValues.map((relaxation) => ({
        label: `s=${stiffness.toExponential(0)} r=${relaxation}`,
        stiffness,
        relaxation,
      })),
    ),
  ]

  for (const variant of variants) {
    const trials = seeds.map((seed) => ({
      seed,
      result: runTrial({
        seed,
        shapeMode: 'box',
        diceDiceContactEquationStiffness: variant.stiffness,
        diceDiceContactEquationRelaxation: variant.relaxation,
      }),
    }))

    const settleTimes = trials.map(({ result }) => result.settleTime)
    rows.push({
      label: variant.label,
      stiffness: variant.stiffness,
      relaxation: variant.relaxation,
      timeoutCount: trials.filter(({ result }) => result.settlePath === 'timeout').length,
      tiltDice: trials.reduce((sum, { result }) => sum + result.tiltCount, 0),
      avgSettle: average(settleTimes),
      maxSettle: Math.max(...settleTimes),
      over4s: settleTimes.filter((time) => time > 4).length,
      avgBroken: average(trials.map(({ result }) => result.stableBrokenCount)),
      stickySeeds: trials
        .filter(({ result }) => result.settleTime > 4 || result.stableBrokenCount >= 8)
        .map(({ seed, result }) => `${seed}:${result.settleTime.toFixed(1)}s/${result.stableBrokenCount}`),
    })
  }

  return rows
}

function compareRows(a: ResultRow, b: ResultRow): number {
  return (
    a.timeoutCount - b.timeoutCount ||
    a.tiltDice - b.tiltDice ||
    a.over4s - b.over4s ||
    a.avgSettle - b.avgSettle ||
    a.maxSettle - b.maxSettle ||
    a.avgBroken - b.avgBroken
  )
}

const args = parseArgs()
const seeds = parseNumberList(args['seeds'], DEFAULT_SEEDS)
const stiffnessValues = parseNumberList(args['stiffness'], DEFAULT_STIFFNESS_VALUES)
const relaxationValues = parseNumberList(args['relaxation'], DEFAULT_RELAXATION_VALUES)

const rows = buildRows(seeds, stiffnessValues, relaxationValues)
const rankedRows = [...rows].sort(compareRows)

console.log('╔══════════════════════════════════════════════════╗')
console.log('║      dice-dice contact-equation 2D sweep         ║')
console.log('╚══════════════════════════════════════════════════╝')
console.log(`seeds=${seeds.length}, stiffness=${stiffnessValues.join('/')}, relaxation=${relaxationValues.join('/')}\n`)

console.log('variant              | timeout | tilt | avgSettle | maxSettle | >4s | avgBroken | sticky seeds')
console.log('---------------------|---------|------|-----------|-----------|-----|-----------|-----------------------------')

for (const row of rows) {
  console.log(
    `${row.label.padEnd(20)} | ${String(row.timeoutCount).padStart(3)}/${String(seeds.length).padEnd(3)} | ` +
      `${String(row.tiltDice).padStart(3)}/${String(seeds.length * 6).padEnd(3)} | ` +
      `${row.avgSettle.toFixed(2).padStart(8)}s | ${row.maxSettle.toFixed(2).padStart(8)}s | ` +
      `${String(row.over4s).padStart(3)} | ${row.avgBroken.toFixed(1).padStart(8)} | ${row.stickySeeds.join(' ') || '-'}`,
  )
}

console.log('\nTop candidates:')
for (const row of rankedRows.slice(0, 5)) {
  console.log(
    `  ${row.label}: timeout=${row.timeoutCount}/${seeds.length} tilt=${row.tiltDice}/${seeds.length * 6} ` +
      `avg=${row.avgSettle.toFixed(2)}s max=${row.maxSettle.toFixed(2)}s broken=${row.avgBroken.toFixed(1)}`,
  )
}

console.log('\nwatch seeds: 1776401121559, 1776401998577, 1776308150130, 1776308167330')