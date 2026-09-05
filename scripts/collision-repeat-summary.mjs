import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 固定补一次同条件重复，不按单次结果挑选；沿用 0.9 / 4 seeds / 收益超过噪声的阈值。
const inputs = process.argv.slice(2)
assert.equal(inputs.length, 2, '需要首轮和补充轮两个完整浏览器 A/B JSON')
const runs = inputs.map((input) => JSON.parse(readFileSync(input, 'utf8')))
for (const run of runs) {
  assert.equal(run.result.status, 'passed')
  assert.equal(run.repository.unchangedDuringRun, true)
  assert.equal(run.summary.strictEquivalentSeedCount, 5)
  assert.equal(run.summary.measuredRolls, 20)
}
assert.deepEqual(runs[0].repository.start, runs[1].repository.start, '两次必须使用同一源码快照')
assert.deepEqual(runs[0].seeds, runs[1].seeds)
assert.deepEqual(runs[0].fixedRuntimeContracts, runs[1].fixedRuntimeContracts)
assert.equal(runs[0].project, runs[1].project)
assert.equal(runs[0].browserVersion, runs[1].browserVersion)
const median = (values) => {
  assert(values.length && values.every(Number.isFinite))
  const sorted = [...values].sort((a, b) => a - b)
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
}
// 对全部重复观测使用成对差异的中位数；只有两个观测时恰好等于原脚本的定义。
function repeatNoise(values) {
  const differences = values.flatMap((value, index) =>
    values.slice(index + 1).map((other) => Math.abs(value - other)),
  )
  return median(differences) / median(values)
}
const pairs = runs[0].seeds.map((seed) => ({
  seed,
  ...Object.fromEntries(
    ['p50', 'p95'].map((metric) => {
      const evidence = runs.map(
        (run) =>
          run.result.pairs.find((pair) => pair.seed === seed).performance.impact
            .narrowphaseCpuMsPerStep[metric],
      )
      const baselineValues = evidence.flatMap((entry) => entry.baselineValues)
      const candidateValues = evidence.flatMap((entry) => entry.candidateValues)
      assert.equal(baselineValues.length, 4)
      assert.equal(candidateValues.length, 4)
      return [
        metric,
        {
          baselineValues,
          candidateValues,
          ratio: median(candidateValues) / median(baselineValues),
          baselineRepeatNoise: repeatNoise(baselineValues),
          candidateRepeatNoise: repeatNoise(candidateValues),
        },
      ]
    }),
  ),
}))
const summary = Object.fromEntries(
  ['p50', 'p95'].map((metric) => {
    const ratio = median(pairs.map((pair) => pair[metric].ratio))
    const noise = median(
      pairs.flatMap((pair) => [
        pair[metric].baselineRepeatNoise,
        pair[metric].candidateRepeatNoise,
      ]),
    )
    return [metric, { ratio, repeatNoise: noise, benefitExceedsNoise: 1 - ratio > noise }]
  }),
)
const improvingSeeds = pairs.filter((pair) => pair.p50.ratio < 1 && pair.p95.ratio < 1).length
const passed =
  improvingSeeds >= 4 &&
  Object.values(summary).every((metric) => metric.ratio <= 0.9 && metric.benefitExceedsNoise)
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      inputs,
      source: runs[0].repository.start,
      project: runs[0].project,
      browserVersion: runs[0].browserVersion,
      measuredRolls: 40,
      firstSummary: runs[0].summary,
      secondSummary: runs[1].summary,
      summary,
      improvingSeeds,
      passed,
      pairs,
    },
    null,
    2,
  ),
)
if (!passed) process.exitCode = 1
