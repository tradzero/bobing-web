export interface SeatedPlayer {
  id: string
  seat: number
}

function orderedPlayers(players: readonly SeatedPlayer[]): SeatedPlayer[] {
  const ordered = [...players].sort((a, b) => a.seat - b.seat)
  const ids = new Set<string>()
  const seats = new Set<number>()
  for (const player of ordered) {
    if (!player.id) throw new RangeError('玩家 ID 不能为空')
    if (!Number.isInteger(player.seat) || player.seat < 0) {
      throw new RangeError('座位必须是非负整数')
    }
    if (ids.has(player.id) || seats.has(player.seat)) {
      throw new RangeError('玩家 ID 和座位必须在本局内唯一')
    }
    ids.add(player.id)
    seats.add(player.seat)
  }
  return ordered
}

export function nextPlayerId(players: readonly SeatedPlayer[], currentPlayerId: string): string {
  const ordered = orderedPlayers(players)
  if (ordered.length === 0) throw new RangeError('至少需要一名玩家')
  const currentIndex = ordered.findIndex(({ id }) => id === currentPlayerId)
  if (currentIndex < 0) throw new RangeError('当前玩家不在本局座位中')
  return ordered[(currentIndex + 1) % ordered.length].id
}

/** 奖池博完后从下一座开始，博完最后一份的玩家最后投。 */
export function createBonusRoundQueue(
  players: readonly SeatedPlayer[],
  completingPlayerId: string,
): string[] {
  const ordered = orderedPlayers(players)
  if (ordered.length === 0) throw new RangeError('至少需要一名玩家')
  const completingIndex = ordered.findIndex(({ id }) => id === completingPlayerId)
  if (completingIndex < 0) throw new RangeError('博完奖池的玩家不在本局座位中')

  return ordered.map((_, offset) => ordered[(completingIndex + 1 + offset) % ordered.length].id)
}
