import assert from 'node:assert/strict'
import { runRoll } from '@dice/physics-core'
import { readRepositoryState } from '../tooling/repository-state'

const seeds = [50_000, 55_000, 60_000, 65_000, 70_000, 25_042, 105_000, 166_000]
const modes = ['cannon-default', 'projected-aabb-v1'] as const
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
}
const budgets = { medianRatioMax: 0.9, improvingSeedsMin: 7, benefitMustExceedRepeatNoise: true }
for (const mode of modes) runRoll({ seed: 42, heightfieldNarrowphaseMode: mode })
const pairs = seeds.map((seed, index) => {
  const order = index % 2 ? [1, 0, 0, 1] : [0, 1, 1, 0]
  const values: [number[], number[]] = [[], []]
  let reference: ReturnType<typeof runRoll> | undefined
  for (const modeIndex of order) {
    const start = performance.now()
    const result = runRoll({ seed, heightfieldNarrowphaseMode: modes[modeIndex] })
    values[modeIndex].push(performance.now() - start)
    if (reference) assert.deepStrictEqual(result, reference, `seed ${seed}`)
    else reference = result
  }
  return {
    seed,
    baselineMs: values[0],
    candidateMs: values[1],
    ratio: median(values[1]) / median(values[0]),
    repeatNoise: values.map(
      (observations) => Math.abs(observations[0] - observations[1]) / median(observations),
    ),
  }
})
const ratio = median(pairs.map((pair) => pair.ratio))
const repeatNoise = median(pairs.flatMap((pair) => pair.repeatNoise))
const improvingSeeds = pairs.filter((pair) => pair.ratio < 1).length
const passed =
  ratio <= budgets.medianRatioMax &&
  improvingSeeds >= budgets.improvingSeedsMin &&
  1 - ratio > repeatNoise
console.log(
  JSON.stringify(
    {
      node: process.version,
      repository: readRepositoryState(),
      budgets,
      seedCount: seeds.length,
      measuredRolls: seeds.length * 4,
      ratio,
      repeatNoise,
      improvingSeeds,
      passed,
      pairs,
    },
    null,
    2,
  ),
)
if (!passed) process.exitCode = 1
