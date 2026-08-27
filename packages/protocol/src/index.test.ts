// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MULTIPLAYER_PROTOCOL_VERSION, parseClientMessage } from '.'

describe('多人 WebSocket 协议入口', () => {
  it('解析带房间 ID 的加入消息，为未来多房间保留边界', () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          type: 'join-room',
          protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
          roomId: 'default',
          displayName: ' Alice ',
        }),
      ),
    ).toEqual({
      type: 'join-room',
      protocolVersion: 1,
      roomId: 'default',
      displayName: 'Alice',
    })
  })

  it('拒绝旧协议和非 UUID 幂等命令', () => {
    expect(() =>
      parseClientMessage(
        JSON.stringify({
          type: 'join-room',
          protocolVersion: 0,
          roomId: 'default',
          displayName: 'Alice',
        }),
      ),
    ).toThrow(/\u7248本/)
    expect(() =>
      parseClientMessage(JSON.stringify({ type: 'request-roll', commandId: 'duplicate' })),
    ).toThrow(/UUID/)
  })

  it('限制昵称长度和未知命令', () => {
    expect(() =>
      parseClientMessage(
        JSON.stringify({
          type: 'join-room',
          protocolVersion: 1,
          roomId: 'default',
          displayName: 'x'.repeat(25),
        }),
      ),
    ).toThrow(/displayName/)
    expect(() => parseClientMessage(JSON.stringify({ type: 'reset-everything' }))).toThrow(
      /\u672a知/,
    )
  })
})
