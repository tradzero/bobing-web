import { useGameStore } from './GameStoreContext'
import { useGameController } from './GameControllerContext'

/** 不可信物理结算的恢复面板：当前轮不派奖，只允许重新投掷或重置。 */
export function RollErrorPanel() {
  const phase = useGameStore((state) => state.phase)
  const rollError = useGameStore((state) => state.rollError)
  const ctrl = useGameController()

  if (phase !== 'error' || !rollError) return null

  const isTimeout = rollError.reason === 'timeout'

  return (
    <div className="roll-error" role="alert" aria-live="assertive">
      <div className="tilt-warning-kicker">本轮未结算</div>
      <div className="tilt-warning-icon" aria-hidden="true">
        ⚠
      </div>
      <div className="tilt-warning-text">
        {isTimeout
          ? '骰子在限定时间内未能可信停稳，本轮未读取点数，也未计入记录。'
          : '页面帧调度持续落后，物理模拟积压超过安全上限，本轮未读取点数，也未计入记录。'}
      </div>
      <div className="roll-error-detail">
        {isTimeout ? (
          <>异常原因：结算超时（{rollError.elapsed.toFixed(1)} 秒）</>
        ) : (
          <>
            异常原因：物理时间积压（队列 {rollError.queuedMs.toFixed(1)} 毫秒，安全上限{' '}
            {rollError.highWaterMs.toFixed(1)} 毫秒；已模拟 {rollError.simulationElapsed.toFixed(2)}{' '}
            秒 / {rollError.executedSteps} 步）
          </>
        )}
      </div>
      <div className="tilt-warning-actions">
        <button className="btn btn-accept" onClick={() => ctrl.rethrow()}>
          重新掷骰
        </button>
        <button className="btn btn-rethrow" onClick={() => ctrl.reset()}>
          重置
        </button>
      </div>
    </div>
  )
}
