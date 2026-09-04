// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseRoomResetCliOptions, resolveRoomResetTarget } from './reset-cli-options'

describe('房间强制重置 CLI 参数', () => {
  it('接受等号和分隔参数形式', () => {
    expect(parseRoomResetCliOptions(['--room=default', '--confirm', 'default'])).toEqual({
      help: false,
      roomId: 'default',
      confirmRoomId: 'default',
    })
  })

  it('允许省略 room 以使用环境变量默认值', () => {
    expect(parseRoomResetCliOptions(['--confirm=lan-room'])).toEqual({
      help: false,
      confirmRoomId: 'lan-room',
    })
  })

  it('拒绝未知、重复和空房间参数', () => {
    expect(() => parseRoomResetCliOptions(['--yes'])).toThrow(/未知参数/)
    expect(() => parseRoomResetCliOptions(['--room=a', '--room=b'])).toThrow(/不能重复/)
    expect(() => parseRoomResetCliOptions(['--confirm='])).toThrow(/1\.\.64/)
  })

  it('确认值必须与显式或默认房间完全一致', () => {
    expect(resolveRoomResetTarget(parseRoomResetCliOptions(['--confirm=default']), 'default')).toBe(
      'default',
    )
    expect(() =>
      resolveRoomResetTarget(
        parseRoomResetCliOptions(['--room=lan', '--confirm=default']),
        'default',
      ),
    ).toThrow(/--confirm=lan/)
  })
})
