import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { AuthoritativeRoll, RollAuthorityOptions } from './authority'

interface Job {
  id: number
  options: RollAuthorityOptions
  seed?: number
  resolve: (outcome: AuthoritativeRoll) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}
interface Slot {
  worker: Worker
  job?: Job
}

export class RollWorkerPoolError extends Error {}

/** 固定并发和有界队列；超时包含排队时间，超时的运行任务销毁 worker，不能迟到提交。 */
interface PoolConfig {
  size: number
  maxQueue: number
  timeoutMs: number
  workerUrl?: string | URL
}

export class RollWorkerPool {
  private readonly config: PoolConfig
  private readonly slots = new Set<Slot>()
  private readonly queue: Job[] = []
  private readonly retiring = new Set<Promise<number>>()
  private nextId = 0
  private closed = false

  constructor(config: PoolConfig) {
    this.config = config
    if (
      !Number.isInteger(config.size) ||
      config.size < 1 ||
      !Number.isInteger(config.maxQueue) ||
      config.maxQueue < 0 ||
      !Number.isFinite(config.timeoutMs) ||
      config.timeoutMs <= 0
    ) {
      throw new RangeError('无效的物理 worker 池配置')
    }
  }

  run(options: RollAuthorityOptions, seed?: number): Promise<AuthoritativeRoll> {
    if (this.closed) return Promise.reject(new RollWorkerPoolError('物理服务已停止'))
    const active = [...this.slots].filter((slot) => slot.job).length
    if (active + this.queue.length >= this.config.size + this.config.maxQueue) {
      return Promise.reject(new RollWorkerPoolError('投掷请求较多，请稍后重试'))
    }
    return new Promise((resolve, reject) => {
      const job: Job = {
        id: ++this.nextId,
        options,
        seed,
        resolve,
        reject,
        timer: setTimeout(() => {
          const slot = [...this.slots].find((candidate) => candidate.job === job)
          if (slot) this.retire(slot)
          else {
            const index = this.queue.indexOf(job)
            if (index >= 0) this.queue.splice(index, 1)
          }
          reject(new RollWorkerPoolError('物理计算超时，请重试'))
          this.pump()
        }, this.config.timeoutMs),
      }
      this.queue.push(job)
      this.pump()
    })
  }

  private retire(slot: Slot): void {
    this.slots.delete(slot)
    const termination = slot.worker.terminate()
    this.retiring.add(termination)
    void termination.finally(() => this.retiring.delete(termination))
  }

  private pump(): void {
    while (!this.closed && this.queue.length) {
      let slot = [...this.slots].find((candidate) => !candidate.job)
      if (!slot) {
        if (this.slots.size >= this.config.size) return
        try {
          slot = {
            worker: new Worker(
              this.config.workerUrl ?? path.resolve(process.cwd(), 'dist-server/roll-worker.js'),
            ),
          }
        } catch {
          const job = this.queue.shift()!
          clearTimeout(job.timer)
          job.reject(new RollWorkerPoolError('物理服务暂时不可用'))
          continue
        }
        this.slots.add(slot)
        const current = slot
        const fail = () => {
          if (!this.slots.has(current)) return
          if (current.job) {
            clearTimeout(current.job.timer)
            current.job.reject(new RollWorkerPoolError('物理服务暂时不可用'))
          }
          this.retire(current)
          this.pump()
        }
        slot.worker.on('error', fail)
        slot.worker.on('exit', fail)
        slot.worker.on(
          'message',
          (reply: { id: number; outcome?: AuthoritativeRoll; error?: string }) => {
            const job = current.job
            if (!this.slots.has(current) || !job || reply.id !== job.id) return
            clearTimeout(job.timer)
            current.job = undefined
            if (reply.outcome) job.resolve(reply.outcome)
            else job.reject(new RollWorkerPoolError('权威物理计算失败'))
            this.pump()
          },
        )
      }
      slot.job = this.queue.shift()!
      slot.worker.postMessage({ id: slot.job.id, options: slot.job.options, seed: slot.job.seed })
    }
  }

  async close(): Promise<void> {
    this.closed = true
    const jobs = [
      ...this.queue.splice(0),
      ...[...this.slots].flatMap((slot) => (slot.job ? [slot.job] : [])),
    ]
    for (const job of jobs) {
      clearTimeout(job.timer)
      job.reject(new RollWorkerPoolError('物理服务已停止'))
    }
    for (const slot of this.slots) this.retire(slot)
    await Promise.allSettled(this.retiring)
  }
}
