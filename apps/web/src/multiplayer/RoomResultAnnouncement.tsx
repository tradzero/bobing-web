import { useState } from 'react'
import { useGameStore } from '@/ui/components/GameStoreContext'
import { ResultAnnouncement } from '@/ui/components/ResultAnnouncement'
import { RollSeedBridge } from './RollSeedBridge'
import type { MultiplayerRoomState } from './use-room'

export function RoomResultAnnouncement({ state }: { state: MultiplayerRoomState }) {
  const [playedRollId, setPlayedRollId] = useState<string | null>(null)
  const phase = useGameStore((store) => store.phase)
  const { snapshot, activeRoll, pendingCommand } = state
  const roll = snapshot?.recentRolls[0]
  // 服务端结算可能先于本机动画到达；只揭晓本机播放过且已经停稳的同一投。
  // 本机倾斜态只有在服务端已确认、写入 recentRolls 后才允许播报。
  const canReveal =
    roll &&
    roll.id === playedRollId &&
    (phase === 'result' || phase === 'tilt-confirm') &&
    (!activeRoll || activeRoll.id === roll.id) &&
    pendingCommand !== 'request-roll'
  const playerName = snapshot?.members.find(({ id }) => id === roll?.playerId)?.displayName
  const note =
    roll?.allocationReason === 'out-of-stock'
      ? '这份奖已博完，好手气照样记下'
      : roll?.allocationReason === 'bonus-no-allocation'
        ? '加投留彩，本轮不发放普通奖品'
        : roll?.allocationReason === 'zhuangyuan-claim'
          ? '状元争魁，归属以本桌榜单为准'
          : undefined

  return (
    <>
      <RollSeedBridge activeRoll={activeRoll} onPlaybackStarted={setPlayedRollId} />
      {canReveal && (
        <ResultAnnouncement
          key={roll.id}
          playerName={playerName ?? '这位博友'}
          result={roll.result}
          diceValues={roll.diceValues}
          note={note}
        />
      )}
    </>
  )
}
