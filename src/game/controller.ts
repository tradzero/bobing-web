import type { DicePair } from '@/dice/create'
import { throwDice } from '@/dice/throw'
import { readAllFaces } from '@/dice/read-face'
import { judge } from '@/rules/judge'
import type { createGameStore } from './store'
import type { Engine } from './engine'

export interface GameControllerDeps {
  store: ReturnType<typeof createGameStore>
  engine: Engine
  dicePairs: DicePair[]
}

/**
 * 游戏编排层（唯一业务入口）
 * 管理状态机、轮次推进、结算触发、重置
 */
export class GameController {
  private store: ReturnType<typeof createGameStore>
  private engine: Engine
  private dicePairs: DicePair[]

  constructor(deps: GameControllerDeps) {
    this.store = deps.store
    this.engine = deps.engine
    this.dicePairs = deps.dicePairs
  }

  /** 掷骰：拒绝 rolling 阶段调用 */
  throw(): void {
    const { phase } = this.store.getState()
    if (phase === 'rolling') return

    this.store.getState().setPhase('rolling')
    throwDice(this.dicePairs)
    this.engine.beginSettle()
  }

  /** 停稳回调：读取点数 → 判定奖级 → 更新 store */
  onSettled(): void {
    const bodies = this.dicePairs.map((p) => p.body)
    const diceValues = readAllFaces(bodies)
    const result = judge(diceValues)
    this.store.getState().setResult({ diceValues, result })
  }

  /** 重置：拒绝 rolling 阶段调用 */
  reset(): void {
    const { phase } = this.store.getState()
    if (phase === 'rolling') return

    this.store.getState().resetState()

    // 骰子回到碗上方初始位置
    this.dicePairs.forEach(({ body }, i) => {
      const angle = (i / this.dicePairs.length) * Math.PI * 2
      body.position.set(Math.cos(angle) * 0.3, 1.5, Math.sin(angle) * 0.3)
      body.velocity.set(0, 0, 0)
      body.angularVelocity.set(0, 0, 0)
      body.quaternion.set(0, 0, 0, 1)
      body.wakeUp()
    })
  }

  /** 音效开关 */
  toggleSound(): void {
    this.store.getState().toggleSound()
  }
}
