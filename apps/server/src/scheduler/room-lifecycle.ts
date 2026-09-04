import type { RoomLifecycleConfig, RoomLifecycleSweepResult } from '../room/repository'

export interface LifecycleRepository {
  processRoomLifecycle: (
    now: number,
    config: RoomLifecycleConfig,
    defaultRoomId: string,
  ) => Promise<RoomLifecycleSweepResult>
}

export interface RoomLifecycleSchedulerOptions {
  repository: LifecycleRepository
  config: RoomLifecycleConfig
  defaultRoomId: string
  pollIntervalMs: number
  now?: () => number
  onRoomsAbandoned?: (roomIds: string[]) => void | Promise<void>
  onRoomsArchived?: (roomIds: string[]) => void | Promise<void>
}

const EMPTY_RESULT: RoomLifecycleSweepResult = {
  abandonedRoomIds: [],
  archivedRoomIds: [],
  deletedRoomIds: [],
}

/** 内存轮询只负责唤醒；活动、在线、归档和删除时间都以 PostgreSQL 为准。 */
export class RoomLifecycleScheduler {
  private readonly options: RoomLifecycleSchedulerOptions
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(options: RoomLifecycleSchedulerOptions) {
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

  async runOnce(): Promise<RoomLifecycleSweepResult> {
    if (this.running) return EMPTY_RESULT
    this.running = true
    try {
      const result = await this.options.repository.processRoomLifecycle(
        (this.options.now ?? Date.now)(),
        this.options.config,
        this.options.defaultRoomId,
      )
      if (result.abandonedRoomIds.length > 0) {
        await this.options.onRoomsAbandoned?.(result.abandonedRoomIds)
      }
      if (result.archivedRoomIds.length > 0) {
        await this.options.onRoomsArchived?.(result.archivedRoomIds)
      }
      return result
    } catch (error) {
      console.error('[scheduler] room lifecycle tick failed', error)
      return EMPTY_RESULT
    } finally {
      this.running = false
    }
  }
}
