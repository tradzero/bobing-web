import assert from 'node:assert/strict'
import { computeAuthoritativeRoll } from '../apps/server/src/roll/authority'
import { RollWorkerPool } from '../apps/server/src/roll/worker-pool'

const options = { revealMinMs: 1_200, revealMaxMs: 10_000 }
const seeds = [42, 105_000, 25_042, 991_817]
const workers = new RollWorkerPool({ size: 2, maxQueue: 4, timeoutMs: 10_000 })
let heartbeatTicks = 0
const heartbeat = setInterval(() => heartbeatTicks++, 5)
try {
  const outcomes = await Promise.all(seeds.map((seed) => workers.run(options, seed)))
  assert(heartbeatTicks > 0, 'worker 计算期间主线程必须保持响应')
  for (const [index, seed] of seeds.entries()) {
    assert.deepStrictEqual(outcomes[index], computeAuthoritativeRoll(options, seed))
  }
  console.log(
    JSON.stringify({
      passed: true,
      seeds,
      heartbeatTicks,
      workerEntry: 'dist-server/roll-worker.js',
    }),
  )
} finally {
  clearInterval(heartbeat)
  await workers.close()
}
