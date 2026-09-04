import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AwardTier, type AwardTier as AwardTierType } from '@dice/game-domain'
import { PLAYER_DISPLAY_NAME_MAX_LENGTH, type RoomSnapshot } from '@dice/protocol'
import { GameViewport } from '@/ui/components/GameViewport'
import { useGameController } from '@/ui/components/GameControllerContext'
import { useMultiplayerRoom, type MultiplayerRoomState, type RoomCommand } from './use-room'
import '@/ui/styles/multiplayer.css'

const AWARD_ORDER: AwardTierType[] = [
  AwardTier.ZhuangYuan,
  AwardTier.DuiTang,
  AwardTier.SanHong,
  AwardTier.SiJin,
  AwardTier.ErJu,
  AwardTier.YiXiu,
]

const AWARD_LABELS: Record<AwardTierType, string> = {
  zhuangyuan: '状元',
  duitang: '对堂',
  sanhong: '三红',
  sijin: '四进',
  erju: '二举',
  yixiu: '一秀',
}

function RollSeedBridge({ activeRoll }: Pick<MultiplayerRoomState, 'activeRoll'>) {
  const controller = useGameController()
  const lastRollId = useRef<string | null>(null)
  useEffect(() => {
    if (!activeRoll || lastRollId.current === activeRoll.id) return
    if (controller.throwAuthoritative(activeRoll.seed)) lastRollId.current = activeRoll.id
  }, [activeRoll, controller])
  return null
}

function useRemainingMs(deadlineAt: string | null, serverTime: string | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null)
  useEffect(() => {
    if (!deadlineAt || !serverTime) return
    const offset = Date.parse(serverTime) - Date.now()
    const update = () => setRemaining(Math.max(0, Date.parse(deadlineAt) - (Date.now() + offset)))
    const initial = window.setTimeout(update, 0)
    const timer = window.setInterval(update, 250)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [deadlineAt, serverTime])
  return remaining
}

function PlayerName({ snapshot, playerId }: { snapshot: RoomSnapshot; playerId: string }) {
  return <>{snapshot.members.find(({ id }) => id === playerId)?.displayName ?? '未知玩家'}</>
}

function AwardInventory({ snapshot, playerId }: { snapshot: RoomSnapshot; playerId: string }) {
  const mine = snapshot.awardsByPlayer[playerId]
  return (
    <aside className="room-awards" aria-label="奖项获取情况">
      <div className="room-panel-title">我的奖项</div>
      <div className="room-award-grid">
        {AWARD_ORDER.map((tier) => (
          <div className="room-award" key={tier}>
            <span>{AWARD_LABELS[tier]}</span>
            <strong>{mine?.[tier] ?? 0}</strong>
            <small>余 {snapshot.prizePool[tier]}</small>
          </div>
        ))}
      </div>
      <div className="room-panel-title room-panel-title-spaced">全员获取</div>
      <div className="room-player-awards">
        {snapshot.members
          .filter(({ role }) => role === 'player')
          .map((member) => (
            <div className="room-player-award-row" key={member.id}>
              <span>
                <i className={member.connected ? 'is-online' : ''} />
                {member.displayName}
              </span>
              <span>
                {AWARD_ORDER.map((tier) => snapshot.awardsByPlayer[member.id]?.[tier] ?? 0).reduce(
                  (total, count) => total + count,
                  0,
                )}{' '}
                份
              </span>
            </div>
          ))}
      </div>
      {snapshot.zhuangyuan && (
        <div className="room-zhuangyuan">
          当前状元：
          <PlayerName snapshot={snapshot} playerId={snapshot.zhuangyuan.playerId} />
          <small>{snapshot.zhuangyuan.result.description}</small>
        </div>
      )}
    </aside>
  )
}

function RoomAction({
  state,
  sendCommand,
}: {
  state: MultiplayerRoomState
  sendCommand: (message: RoomCommand) => boolean
}) {
  const { snapshot, playerId, pendingCommand } = state
  const turn = snapshot?.currentTurn ?? null
  const deadline =
    snapshot?.phase === 'end-decision' ? snapshot.endDecisionDeadlineAt : (turn?.deadlineAt ?? null)
  const remaining = useRemainingMs(deadline, snapshot?.serverTime ?? null)
  if (!snapshot || !playerId) return null
  const isHost = snapshot.hostPlayerId === playerId
  const isMyTurn = turn?.playerId === playerId
  const countdown = remaining === null ? null : `${Math.ceil(remaining / 1_000)} 秒`

  if (snapshot.phase === 'lobby') {
    return (
      <div className="room-action-card">
        <strong>{isHost ? '人员到齐后开始' : '等待房主开始游戏'}</strong>
        <span>{snapshot.members.filter(({ role }) => role === 'player').length} 位玩家已入座</span>
        {isHost && (
          <button
            className="room-primary-button"
            disabled={pendingCommand !== null}
            onClick={() => sendCommand({ type: 'start-game' })}
          >
            开始博饼
          </button>
        )}
      </div>
    )
  }

  if (snapshot.phase === 'end-decision') {
    return (
      <div className="room-action-card">
        <strong>63 份奖项已博完</strong>
        <span>{isHost ? `请选择结束方式 · ${countdown}` : `等待房主选择 · ${countdown}`}</span>
        {isHost && (
          <div className="room-action-row">
            <button
              className="room-secondary-button"
              onClick={() => sendCommand({ type: 'choose-end', mode: 'immediate' })}
            >
              立即结束
            </button>
            <button
              className="room-primary-button"
              onClick={() => sendCommand({ type: 'choose-end', mode: 'bonus-round' })}
            >
              每人再投一轮
            </button>
          </div>
        )}
      </div>
    )
  }

  if (snapshot.phase === 'finished' || snapshot.phase === 'abandoned') {
    const abandoned = snapshot.phase === 'abandoned'
    return (
      <div className="room-action-card">
        <strong>{abandoned ? '本局因长期无人操作已停止' : '本局已结束'}</strong>
        <span>
          {isHost
            ? `${abandoned ? '当前奖项记录已保留，' : '最终结果已保存，'}可以按原阵容再开一局`
            : '等待房主再开一局'}
        </span>
        {isHost && (
          <button
            className="room-primary-button"
            disabled={pendingCommand !== null}
            onClick={() => sendCommand({ type: 'start-game' })}
          >
            再开一局
          </button>
        )}
      </div>
    )
  }

  if (!turn) return null
  if (turn.status === 'tilt-decision') {
    return (
      <div className="room-action-card room-action-warning">
        <strong>骰子姿态需要确认</strong>
        <span>{isMyTurn ? `接受当前点数或重投 · ${countdown}` : '等待当前玩家确认'}</span>
        {isMyTurn && (
          <div className="room-action-row">
            <button
              className="room-secondary-button"
              onClick={() => sendCommand({ type: 'tilt-decision', decision: 'retry' })}
            >
              同回合重投
            </button>
            <button
              className="room-primary-button"
              onClick={() => sendCommand({ type: 'tilt-decision', decision: 'accept' })}
            >
              接受结果
            </button>
          </div>
        )}
      </div>
    )
  }

  if (turn.status === 'rolling' || pendingCommand === 'request-roll') {
    return (
      <div className="room-action-card">
        <strong>
          {pendingCommand === 'request-roll' ? '服务端正在计算真实物理' : '骰子翻滚中'}
        </strong>
        <span>
          <PlayerName snapshot={snapshot} playerId={turn.playerId} /> 正在投掷
        </span>
      </div>
    )
  }

  return (
    <div className="room-action-card">
      <strong>{isMyTurn ? '轮到你了' : `等待 ${countdown}`}</strong>
      <span>
        第 {turn.cycleNumber} 轮 · <PlayerName snapshot={snapshot} playerId={turn.playerId} /> ·{' '}
        {countdown}
      </span>
      {isMyTurn && (
        <button
          className="room-primary-button"
          onClick={() => sendCommand({ type: 'request-roll' })}
        >
          投掷六骰
        </button>
      )}
    </div>
  )
}

function RoomOverlay({
  state,
  reconnect,
  sendCommand,
}: {
  state: MultiplayerRoomState
  reconnect: () => void
  sendCommand: (message: RoomCommand) => boolean
}) {
  const { snapshot, playerId } = state
  if (!snapshot || !playerId) return null
  return (
    <div className="room-overlay">
      <RollSeedBridge activeRoll={state.activeRoll} />
      <header className="room-header">
        <div>
          <small>房间 · {snapshot.roomId}</small>
          <strong>{snapshot.roomDisplayName}</strong>
        </div>
        <div className="room-header-status">
          <span>第 {snapshot.currentTurn?.cycleNumber ?? 0} 轮</span>
          <span>{snapshot.members.find(({ id }) => id === playerId)?.displayName}</span>
          <a className="room-directory-link" href="/rooms">
            房间大厅
          </a>
        </div>
      </header>
      {state.status === 'disconnected' && (
        <div className="room-connection-banner">
          连接已断开，游戏仍在服务端继续
          <button onClick={reconnect}>重新连接</button>
        </div>
      )}
      {state.error && <div className="room-error-banner">{state.error}</div>}
      <AwardInventory snapshot={snapshot} playerId={playerId} />
      <div className="room-history" aria-label="最近结果">
        {snapshot.recentRolls.slice(0, 5).map((roll) => (
          <div key={roll.id}>
            <span>
              <PlayerName snapshot={snapshot} playerId={roll.playerId} />
            </span>
            <strong>{roll.result.description}</strong>
            <small>{roll.diceValues.join(' · ')}</small>
          </div>
        ))}
      </div>
      <RoomAction state={state} sendCommand={sendCommand} />
    </div>
  )
}

function JoinRoom({
  roomId,
  initialName,
  error,
  connecting,
  onJoin,
}: {
  roomId: string
  initialName: string
  error: string | null
  connecting: boolean
  onJoin: (name: string) => void
}) {
  const [name, setName] = useState(initialName)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onJoin(name)
  }
  return (
    <main className="room-join">
      <form onSubmit={submit}>
        <small>局域网联机 · 房间 {roomId}</small>
        <h1>中秋博饼</h1>
        <p>首次输入昵称后会绑定当前浏览器；以后打开同一访问地址将自动恢复身份。</p>
        <label htmlFor="room-display-name">玩家昵称</label>
        <input
          id="room-display-name"
          maxLength={PLAYER_DISPLAY_NAME_MAX_LENGTH}
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：阿明"
        />
        {error && <div className="room-join-error">{error}</div>}
        <button disabled={connecting || !name.trim()}>
          {connecting ? '正在加入…' : '加入房间'}
        </button>
        <a className="room-back-link" href="/rooms">
          返回房间大厅
        </a>
      </form>
    </main>
  )
}

export function MultiplayerApp({ roomId }: { roomId: string }) {
  const { state, connect, reconnect, sendCommand, storedDisplayName } = useMultiplayerRoom(roomId)
  if (!state.snapshot || !state.playerId) {
    return (
      <JoinRoom
        roomId={roomId}
        initialName={storedDisplayName}
        error={state.error}
        connecting={state.status === 'connecting'}
        onJoin={connect}
      />
    )
  }
  return (
    <GameViewport>
      <RoomOverlay state={state} reconnect={reconnect} sendCommand={sendCommand} />
    </GameViewport>
  )
}
