// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { RollWorkerPool } from './worker-pool'

const workerUrl = new URL(
  `data:text/javascript,${encodeURIComponent(`
  import { parentPort } from 'node:worker_threads';
  parentPort.on('message', ({id, seed}) => {
    if (seed === 99) process.exit(1);
    if (seed === 98) return;
    const end = performance.now() + 60;
    while (performance.now() < end) {}
    parentPort.postMessage({id, outcome: {seed}});
  });
`)}`,
)
const options = { revealMinMs: 0, revealMaxMs: 10_000 }
const pools: RollWorkerPool[] = []
function pool(config = {}) {
  const instance = new RollWorkerPool({
    size: 1,
    maxQueue: 1,
    timeoutMs: 1_000,
    workerUrl,
    ...config,
  })
  pools.push(instance)
  return instance
}
afterEach(async () => {
  await Promise.all(pools.splice(0).map((instance) => instance.close()))
})

describe('权威物理 worker 池', () => {
  it('CPU 任务不阻塞主线程，并发/排队都有上限', async () => {
    const workers = pool()
    let ticks = 0
    const heartbeat = setInterval(() => ticks++, 5)
    try {
      const first = workers.run(options, 1)
      const second = workers.run(options, 2)
      await expect(workers.run(options, 3)).rejects.toThrow('投掷请求较多')
      expect(await Promise.all([first, second])).toEqual([{ seed: 1 }, { seed: 2 }])
      expect(ticks).toBeGreaterThan(3)
      expect(await workers.run(options, 4)).toEqual({ seed: 4 })
    } finally {
      clearInterval(heartbeat)
    }
  })

  it('worker 崩溃后拒绝当前任务，并继续处理队列', async () => {
    const workers = pool()
    const failed = expect(workers.run(options, 99)).rejects.toThrow('暂时不可用')
    const queued = workers.run(options, 2)
    await failed
    expect(await queued).toEqual({ seed: 2 })
  })

  it('任务超时包含排队，销毁卡死 worker 后可以继续投掷', async () => {
    const workers = pool({ timeoutMs: 300 })
    const stuck = expect(workers.run(options, 98)).rejects.toThrow('超时')
    const queued = expect(workers.run(options, 98)).rejects.toThrow('超时')
    await Promise.all([stuck, queued])
    expect(await workers.run(options, 3)).toEqual({ seed: 3 })
  })

  it('关闭时拒绝全部运行/排队任务，拒绝后续请求', async () => {
    const workers = pool()
    const active = expect(workers.run(options, 98)).rejects.toThrow('已停止')
    const queued = expect(workers.run(options, 2)).rejects.toThrow('已停止')
    await workers.close()
    await Promise.all([active, queued])
    await expect(workers.run(options, 3)).rejects.toThrow('已停止')
  })
})
