import { parentPort } from 'node:worker_threads'
import { computeAuthoritativeRoll, type RollAuthorityOptions } from './authority'

if (!parentPort) throw new Error('权威物理只能在 worker 中启动')
const port = parentPort
port.on('message', (job: { id: number; options: RollAuthorityOptions; seed?: number }) => {
  try {
    port.postMessage({ id: job.id, outcome: computeAuthoritativeRoll(job.options, job.seed) })
  } catch {
    port.postMessage({ id: job.id, error: '权威物理计算失败' })
  }
})
