import type { DicePair } from '@/dice/create'
import { THROW_ALGORITHM_VERSION, throwDice, type ThrowDiagnostics } from '@/dice/throw'
import { readAllFacesDetailed } from '@/dice/read-face'
import { judge } from '@/rules/judge'
import { SETTLE } from '@/config/settle'
import { reseed, getCurrentSeed } from '@/utils/random'
import { soundManager } from '@/audio/sound'
import type { createGameStore } from './store'
import type { Engine } from './engine'
import { SETTLE_ALGORITHM_VERSION, type SettleResult } from '@/dice/settle'
import { placeDiceAtRest } from '@/dice/rest'

export interface GameControllerDeps {
  store: ReturnType<typeof createGameStore>
  dicePairs: DicePair[]
  /** 仅供可复现验收注入；只影响下一次投掷，消费后立即清空。 */
  nextSeed?: number
  /** 仅供连续可复现验收；按投掷顺序逐个消费，构造时防御复制。 */
  nextSeeds?: readonly number[]
}

export interface GameRollDiagnostics {
  seed: number | null
  throwAlgorithmVersion: typeof THROW_ALGORITHM_VERSION
  placementAlgorithm: ThrowDiagnostics['algorithm'] | null
  placementAttempts: number | null
  placementRestarts: number | null
  placementGroupAttempts: number | null
  randomPlanVersion: ThrowDiagnostics['randomPlanVersion']
  placementPath: ThrowDiagnostics['placementPath'] | null
  fallbackLayout: ThrowDiagnostics['fallbackLayout']
  settleAlgorithmVersion: typeof SETTLE_ALGORITHM_VERSION
  settleReason: SettleResult['reason'] | 'external-call' | null
  settleElapsed: number | null
}

/**
 * 游戏编排层（唯一业务入口）
 * 管理状态机、轮次推进、结算触发、重置
 */
export class GameController {
  private store: ReturnType<typeof createGameStore>
  private engine: Engine | null = null
  private dicePairs: DicePair[]
  private nextSeed: number | undefined
  private nextSeeds: number[]
  private rollDiagnostics: GameRollDiagnostics = {
    seed: null,
    throwAlgorithmVersion: THROW_ALGORITHM_VERSION,
    placementAlgorithm: null,
    placementAttempts: null,
    placementRestarts: null,
    placementGroupAttempts: null,
    randomPlanVersion: null,
    placementPath: null,
    fallbackLayout: null,
    settleAlgorithmVersion: SETTLE_ALGORITHM_VERSION,
    settleReason: null,
    settleElapsed: null,
  }

  constructor(deps: GameControllerDeps) {
    this.store = deps.store
    this.dicePairs = deps.dicePairs
    this.nextSeed = deps.nextSeed
    this.nextSeeds = [...(deps.nextSeeds ?? [])]
  }

  private startRoll(): void {
    // 队列专用于连续验收；耗尽后才回退到旧的单次注入，再回退到运行时时间种子。
    let injectedSeed = this.nextSeeds.shift()
    if (injectedSeed === undefined) {
      injectedSeed = this.nextSeed
      this.nextSeed = undefined
    }
    const seed = reseed(injectedSeed)
    const placement = throwDice(this.dicePairs, { seed })
    this.rollDiagnostics = {
      seed,
      throwAlgorithmVersion: THROW_ALGORITHM_VERSION,
      placementAlgorithm: placement.algorithm,
      placementAttempts: placement.attempts,
      placementRestarts: placement.restarts,
      placementGroupAttempts: placement.groupAttempts,
      randomPlanVersion: placement.randomPlanVersion,
      placementPath: placement.placementPath,
      fallbackLayout: placement.fallbackLayout,
      settleAlgorithmVersion: SETTLE_ALGORITHM_VERSION,
      settleReason: null,
      settleElapsed: null,
    }
  }

  /** 注入 engine 引用（解决 controller ↔ engine 循环依赖） */
  setEngine(engine: Engine): void {
    this.engine = engine
  }

  /** 掷骰：rolling、待确认和异常态均由各自专用流程接管。 */
  throw(): void {
    const { phase } = this.store.getState()
    if (phase === 'rolling' || phase === 'tilt-confirm' || phase === 'error' || !this.engine) return

    this.store.getState().setPhase('rolling')
    this.startRoll()
    this.engine.beginSettle()
  }

  /**
   * 停稳回调：读取详细点数 → 冻结骰子 → 判定倾斜 → 分流
   * 冻结在判定之前，确保 tilt-confirm 期间骰子姿态不漂移
   */
  onSettled(settleResult?: SettleResult): void {
    // rAF/生命周期可能送达重复或迟到回调；只有本轮 rolling 能改变业务状态。
    if (this.store.getState().phase !== 'rolling') return

    const bodies = this.dicePairs.map((p) => p.body)
    this.rollDiagnostics = {
      ...this.rollDiagnostics,
      settleReason: settleResult?.reason ?? 'external-call',
      settleElapsed: settleResult?.elapsed ?? null,
    }

    if (settleResult?.reason === 'timeout') {
      // timeout 只冻结异常画面，绝不读面、判奖、播放中奖音或推进轮次。
      for (const body of bodies) {
        body.velocity.set(0, 0, 0)
        body.angularVelocity.set(0, 0, 0)
        body.sleep()
      }
      this.store.getState().setRollError({ reason: 'timeout', elapsed: settleResult.elapsed })
      return
    }

    // 1. 读取详细结果（点数 + 可信度）
    const detailedResults = readAllFacesDetailed(bodies)
    const diceValues = detailedResults.map((r) => r.value)
    const result = judge(diceValues)

    // 2. 立即冻结全部骰子，消除 Heightfield 表面微弹跳抖动
    for (const body of bodies) {
      body.velocity.set(0, 0, 0)
      body.angularVelocity.set(0, 0, 0)
      body.sleep()
    }

    // 控制台输出完整结算结果，含种子便于复现
    console.log('[博饼结算]', {
      seed: getCurrentSeed(),
      settleReason: settleResult?.reason ?? 'external-call',
      settleElapsed: settleResult?.elapsed,
      diceValues,
      ...result,
      confidences: detailedResults.map((r) => r.confidence.toFixed(3)),
    })

    // 3. 检测倾斜骰子
    const tiltedIndices = detailedResults
      .map((r, i) => (r.confidence < SETTLE.tiltThreshold ? i : -1))
      .filter((i) => i >= 0)

    // 4. 分流：有倾斜 → tilt-confirm，否则 → result
    if (tiltedIndices.length > 0) {
      this.store.getState().setPending({ diceValues, result, tiltedIndices })
    } else {
      this.store.getState().setResult({ diceValues, result })
      this.playCommittedWin(result.prize)
    }
  }

  private playCommittedWin(prize: ReturnType<typeof judge>['prize']): void {
    if (prize !== 'none') soundManager.playWinSound()
  }

  /** 接受倾斜结果：确认待提交数据 → result */
  acceptTilted(): void {
    const { phase } = this.store.getState()
    if (phase !== 'tilt-confirm') return
    this.store.getState().commitPending()
    const committed = this.store.getState().currentResult
    if (committed) this.playCommittedWin(committed.prize)
  }

  /** 重掷：清除待确认/异常数据 → 同一轮重新投掷全部 6 颗。 */
  rethrow(): void {
    const { phase } = this.store.getState()
    if (phase !== 'tilt-confirm' && phase !== 'error') return

    if (phase === 'tilt-confirm') this.store.getState().clearPending()
    else this.store.getState().clearRollError()
    this.startRoll()
    this.engine?.beginSettle()
  }

  /** 重置：rolling 阶段拒绝；其他阶段回到全新 idle，保留音效偏好。 */
  reset(): void {
    const { phase } = this.store.getState()
    if (phase === 'rolling') return

    this.store.getState().resetState()

    placeDiceAtRest(this.dicePairs)
    this.engine?.returnToIdle()
  }

  /** 音效开关 */
  toggleSound(): void {
    this.store.getState().toggleSound()
    const { soundEnabled } = this.store.getState()
    soundManager.setMuted(!soundEnabled)
  }

  /** 返回独立快照，供浏览器门禁与本地诊断记录实际投掷路径。 */
  getRollDiagnostics(): GameRollDiagnostics {
    return { ...this.rollDiagnostics }
  }
}
