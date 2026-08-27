// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { RoomDeadlineScheduler } from './deadlines'

const timing = {
  turnActionTimeoutMs: 30_000,
  tiltDecisionTimeoutMs: 10_000,
  endDecisionTimeoutMs: 30_000,
  maxAutoRetries: 1,
}

describe('持久化 deadline 调度器', () => {
  it('使用注入的服务端时间扫描并通知变化房间', async () => {
    const processDueDeadlines = vi.fn(async () => ({
      changedRoomIds: ['default'],
      autoRollRequests: [],
    }))
    const onRoomsChanged = vi.fn()
    const scheduler = new RoomDeadlineScheduler({
      repository: { processDueDeadlines },
      timing,
      pollIntervalMs: 500,
      now: () => 12_345,
      onRoomsChanged,
    })
    await expect(scheduler.runOnce()).resolves.toEqual(['default'])
    expect(processDueDeadlines).toHaveBeenCalledWith(12_345, timing)
    expect(onRoomsChanged).toHaveBeenCalledWith(['default'])
  })

  it('前一次 tick 未完成时不并发执行第二次', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const processDueDeadlines = vi.fn(async () => {
      await blocked
      return { changedRoomIds: [], autoRollRequests: [] }
    })
    const scheduler = new RoomDeadlineScheduler({
      repository: { processDueDeadlines },
      timing,
      pollIntervalMs: 500,
    })
    const first = scheduler.runOnce()
    await expect(scheduler.runOnce()).resolves.toEqual([])
    expect(processDueDeadlines).toHaveBeenCalledOnce()
    release()
    await first
  })

  it('倾斜确认超时产生自动重投请求时先执行重投再广播房间', async () => {
    const request = { roomId: 'default', playerId: 'player-1' }
    const processDueDeadlines = vi.fn(async () => ({
      changedRoomIds: ['default'],
      autoRollRequests: [request],
    }))
    const order: string[] = []
    const scheduler = new RoomDeadlineScheduler({
      repository: { processDueDeadlines },
      timing,
      pollIntervalMs: 500,
      onAutoRoll: async (received) => {
        expect(received).toEqual(request)
        order.push('roll')
      },
      onRoomsChanged: async () => {
        order.push('broadcast')
      },
    })
    await scheduler.runOnce()
    expect(order).toEqual(['roll', 'broadcast'])
  })
})
