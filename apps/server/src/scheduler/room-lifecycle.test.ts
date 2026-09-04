// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { RoomLifecycleScheduler } from './room-lifecycle'

const config = {
  emptyRoomTtlMs: 3_600_000,
  gameIdleAbandonMs: 1_800_000,
  roomIdleArchiveMs: 86_400_000,
  archivedRoomRetentionMs: 604_800_000,
}

describe('房间生命周期调度器', () => {
  it('按持久化策略扫描，并分别通知废弃和归档房间', async () => {
    const result = {
      abandonedRoomIds: ['active-room'],
      archivedRoomIds: ['idle-room'],
      deletedRoomIds: ['old-room'],
    }
    const processRoomLifecycle = vi.fn(async () => result)
    const onRoomsAbandoned = vi.fn()
    const onRoomsArchived = vi.fn()
    const scheduler = new RoomLifecycleScheduler({
      repository: { processRoomLifecycle },
      config,
      defaultRoomId: 'default',
      pollIntervalMs: 60_000,
      now: () => 123_456,
      onRoomsAbandoned,
      onRoomsArchived,
    })

    await expect(scheduler.runOnce()).resolves.toEqual(result)
    expect(processRoomLifecycle).toHaveBeenCalledWith(123_456, config, 'default')
    expect(onRoomsAbandoned).toHaveBeenCalledWith(['active-room'])
    expect(onRoomsArchived).toHaveBeenCalledWith(['idle-room'])
  })

  it('前一次扫描未结束时不会并发执行', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const processRoomLifecycle = vi.fn(async () => {
      await blocked
      return { abandonedRoomIds: [], archivedRoomIds: [], deletedRoomIds: [] }
    })
    const scheduler = new RoomLifecycleScheduler({
      repository: { processRoomLifecycle },
      config,
      defaultRoomId: 'default',
      pollIntervalMs: 60_000,
    })

    const first = scheduler.runOnce()
    await expect(scheduler.runOnce()).resolves.toEqual({
      abandonedRoomIds: [],
      archivedRoomIds: [],
      deletedRoomIds: [],
    })
    expect(processRoomLifecycle).toHaveBeenCalledOnce()
    release()
    await first
  })
})
