export interface RoomResetCliOptions {
  help: boolean
  roomId?: string
  confirmRoomId?: string
}

function optionValue(argv: string[], index: number, name: string): { value: string; used: number } {
  const argument = argv[index]
  const inlinePrefix = `${name}=`
  if (argument.startsWith(inlinePrefix)) {
    return { value: argument.slice(inlinePrefix.length), used: 1 }
  }
  const value = argv[index + 1]
  if (argument !== name || value === undefined || value.startsWith('-')) {
    throw new RangeError(`${name} 需要一个房间 ID`)
  }
  return { value, used: 2 }
}

function validateRoomId(value: string, option: string): string {
  const roomId = value.trim()
  if (roomId.length < 1 || roomId.length > 64) {
    throw new RangeError(`${option} 的房间 ID 长度必须在 1..64 之间`)
  }
  return roomId
}

export function parseRoomResetCliOptions(argv: string[]): RoomResetCliOptions {
  const options: RoomResetCliOptions = { help: false }
  for (let index = 0; index < argv.length; ) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      options.help = true
      index += 1
      continue
    }
    if (argument === '--room' || argument.startsWith('--room=')) {
      if (options.roomId !== undefined) throw new RangeError('--room 不能重复指定')
      const parsed = optionValue(argv, index, '--room')
      options.roomId = validateRoomId(parsed.value, '--room')
      index += parsed.used
      continue
    }
    if (argument === '--confirm' || argument.startsWith('--confirm=')) {
      if (options.confirmRoomId !== undefined) throw new RangeError('--confirm 不能重复指定')
      const parsed = optionValue(argv, index, '--confirm')
      options.confirmRoomId = validateRoomId(parsed.value, '--confirm')
      index += parsed.used
      continue
    }
    throw new RangeError(`未知参数 ${argument}`)
  }
  return options
}

export function resolveRoomResetTarget(
  options: RoomResetCliOptions,
  defaultRoomId: string,
): string {
  const roomId = options.roomId ?? defaultRoomId
  if (options.confirmRoomId !== roomId) {
    throw new Error(`拒绝重置房间 ${roomId}：请显式传入 --confirm=${roomId}`)
  }
  return roomId
}

export function roomResetCliUsage(): string {
  return [
    '用法：pnpm room:reset -- --room=<房间ID> --confirm=<房间ID>',
    '',
    '破坏性操作：保留房间配置，永久删除该房间的成员、对局、投掷和奖项数据。',
    '执行前必须停止应用服务；完成后重新启动服务，并让所有玩家刷新页面自动重新绑定。',
    '--room 未指定时使用 DEFAULT_ROOM_ID；--confirm 必须与目标房间 ID 完全一致。',
  ].join('\n')
}
