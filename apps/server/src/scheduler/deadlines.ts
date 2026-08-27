import type { GameTimingConfig } from '@dice/game-domain'
import type { AutoRollRequest, DeadlineSweepResult } from '../room/repository'

export interface DeadlineRepository {
  processDueDeadlines: (now: number, timing: GameTimingConfig) => Promise<DeadlineSweepResult>
}

export interface RoomDeadlineSchedulerOptions {
  repository: DeadlineRepository
  timing: GameTimingConfig
  pollIntervalMs: number
  now?: () => number
  onAutoRoll?: (request: AutoRollRequest) => void | Promise<void>
  onRoomsChanged?: (roomIds: string[]) => void | Promise<void>
}

/** 内存 timer 只负责唤醒，真实 deadline 和幂等转移始终在 PostgreSQL 中。 */
export class RoomDeadlineScheduler {
  private readonly options: RoomDeadlineSchedulerOptions
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(options: RoomDeadlineSchedulerOptions) {
    this.options = options
  }

  start(): void {
    if (this.timer) return
    void this.runOnce()
    this.timer = setInterval(() => void this.runOnce(), this.options.pollIntervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  async runOnce(): Promise<string[]> {
    if (this.running) return []
    this.running = true
    try {
      const result = await this.options.repository.processDueDeadlines(
        (this.options.now ?? Date.now)(),
        this.options.timing,
      )
      for (const request of result.autoRollRequests) await this.options.onAutoRoll?.(request)
      if (result.changedRoomIds.length > 0) {
        await this.options.onRoomsChanged?.(result.changedRoomIds)
      }
      return result.changedRoomIds
    } catch (error) {
      console.error('[scheduler] deadline tick failed', error)
      return []
    } finally {
      this.running = false
    }
  }
}
