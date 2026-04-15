import type { DicePair } from '@/dice/create'
import { throwDice } from '@/dice/throw'
import { readAllFacesDetailed } from '@/dice/read-face'
import { judge } from '@/rules/judge'
import { SETTLE } from '@/config/settle'
import { reseed, getCurrentSeed } from '@/utils/random'
import { soundManager } from '@/audio/sound'
import type { createGameStore } from './store'
import type { Engine } from './engine'

export interface GameControllerDeps {
  store: ReturnType<typeof createGameStore>
  dicePairs: DicePair[]
}

/**
 * 游戏编排层（唯一业务入口）
 * 管理状态机、轮次推进、结算触发、重置
 */
export class GameController {
  private store: ReturnType<typeof createGameStore>
  private engine: Engine | null = null
  private dicePairs: DicePair[]

  constructor(deps: GameControllerDeps) {
    this.store = deps.store
    this.dicePairs = deps.dicePairs
  }

  /** 注入 engine 引用（解决 controller ↔ engine 循环依赖） */
  setEngine(engine: Engine): void {
    this.engine = engine
  }

  /** 掷骰：拒绝 rolling 和 tilt-confirm 阶段调用 */
  throw(): void {
    const { phase } = this.store.getState()
    if (phase === 'rolling' || phase === 'tilt-confirm' || !this.engine) return

    this.store.getState().setPhase('rolling')
    reseed()  // 每次投掷重新播种，便于复现
    throwDice(this.dicePairs)
    this.engine.beginSettle()
  }

  /**
   * 停稳回调：读取详细点数 → 冻结骰子 → 判定倾斜 → 分流
   * 冻结在判定之前，确保 tilt-confirm 期间骰子姿态不漂移
   */
  onSettled(): void {
    const bodies = this.dicePairs.map((p) => p.body)

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
    }

    // 5. 中奖音效反馈
    if (result.prize !== 'none') {
      soundManager.playWinSound()
    }
  }

  /** 接受倾斜结果：确认待提交数据 → result */
  acceptTilted(): void {
    const { phase } = this.store.getState()
    if (phase !== 'tilt-confirm') return
    this.store.getState().commitPending()
  }

  /** 重掷：清除待提交数据 → 全部 6 颗重新投掷 */
  rethrow(): void {
    const { phase } = this.store.getState()
    if (phase !== 'tilt-confirm') return

    this.store.getState().clearPending()
    reseed()
    throwDice(this.dicePairs)
    this.engine?.beginSettle()
  }

  /** 重置：rolling 阶段拒绝，tilt-confirm 阶段清空 pending */
  reset(): void {
    const { phase } = this.store.getState()
    if (phase === 'rolling') return

    this.store.getState().resetState()

    // 骰子回到碗底附近初始位置
    this.dicePairs.forEach(({ body }, i) => {
      const angle = (i / this.dicePairs.length) * Math.PI * 2
      body.position.set(Math.cos(angle) * 0.3, 0.3, Math.sin(angle) * 0.3)
      body.previousPosition.copy(body.position)
      body.velocity.set(0, 0, 0)
      body.angularVelocity.set(0, 0, 0)
      body.quaternion.set(0, 0, 0, 1)
      body.aabbNeedsUpdate = true
      body.wakeUp()
    })
  }

  /** 音效开关 */
  toggleSound(): void {
    this.store.getState().toggleSound()
    const { soundEnabled } = this.store.getState()
    soundManager.setMuted(!soundEnabled)
  }
}
