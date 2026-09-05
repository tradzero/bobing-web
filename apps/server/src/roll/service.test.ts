// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { loadServerConfig } from '../config/env'
import { RoomRollService } from './service'
import type { AuthoritativeRoll } from './authority'

function fixture() {
  const repository = {
    prepareAuthoritativeRoll: vi.fn().mockResolvedValue(null),
    beginAuthoritativeRoll: vi.fn().mockResolvedValue({ rollId: 'roll', seed: 42 }),
    recordAuthoritativeRollError: vi.fn().mockResolvedValue({ shouldAutoRetry: false }),
    resolveTiltDecision: vi.fn().mockResolvedValue(undefined),
  }
  const compute = vi.fn().mockResolvedValue({
    kind: 'committable',
    seed: 42,
    diceValues: [1, 2, 3, 4, 5, 6],
  } as AuthoritativeRoll)
  const service = new RoomRollService(repository, loadServerConfig({ DATABASE_URL: 'unused' }), {
    compute,
  })
  return { service, repository, compute }
}
const request = { roomId: 'room', playerId: 'player', commandId: 'command' }
describe('投掷计算所有权', () => {
  it('同一房间/玩家/命令只计算一次，重放直接返回数据库结果', async () => {
    const { service, repository, compute } = fixture()
    const first = service.requestRoll(request)
    expect(service.requestRoll(request)).toBe(first)
    await first
    expect(compute).toHaveBeenCalledOnce()
    expect(repository.beginAuthoritativeRoll).toHaveBeenCalledOnce()
    repository.prepareAuthoritativeRoll.mockResolvedValue({
      rollId: 'roll',
      seed: 42,
      duplicate: true,
    })
    expect(await service.requestRoll(request)).toMatchObject({ duplicate: true })
    expect(compute).toHaveBeenCalledOnce()
  })

  it('预检失败不占用物理计算，提交失败不记录正常结果', async () => {
    const { service, repository, compute } = fixture()
    repository.prepareAuthoritativeRoll.mockRejectedValueOnce(new Error('未轮到'))
    await expect(service.requestRoll(request)).rejects.toThrow('未轮到')
    expect(compute).not.toHaveBeenCalled()
    repository.beginAuthoritativeRoll.mockRejectedValueOnce(new Error('已超时'))
    await expect(service.requestRoll(request)).rejects.toThrow('已超时')
    expect(repository.recordAuthoritativeRollError).not.toHaveBeenCalled()
  })

  it('不同房间或玩家不能共用幂等请求', async () => {
    const { service, compute } = fixture()
    await Promise.all([
      service.requestRoll(request),
      service.requestRoll({ ...request, roomId: 'other' }),
      service.requestRoll({ ...request, playerId: 'other' }),
    ])
    expect(compute).toHaveBeenCalledTimes(3)
  })
})
