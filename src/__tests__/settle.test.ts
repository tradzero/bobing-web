// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { checkSettled, createSettleState, type SettleState } from '@/dice/settle'
import { SETTLE } from '@/config/settle'
import * as CANNON from 'cannon-es'

/** 创建 mock body */
function mockBody(opts: {
  speed?: number
  angularSpeed?: number
  sleeping?: boolean
}): CANNON.Body {
  const body = new CANNON.Body({ mass: 1 })
  const s = opts.speed ?? 0
  const a = opts.angularSpeed ?? 0
  body.velocity.set(s, 0, 0)
  body.angularVelocity.set(a, 0, 0)
  if (opts.sleeping) {
    body.sleepState = 2 // SLEEPING
  }
  return body
}

describe('停稳检测', () => {
  let state: SettleState

  beforeEach(() => {
    state = createSettleState(0)
  })

  it('全部 sleep 直接结算', () => {
    const bodies = [
      mockBody({ sleeping: true }),
      mockBody({ sleeping: true }),
      mockBody({ sleeping: true }),
    ]
    expect(checkSettled(bodies, 1, state)).toEqual({
      reason: 'natural-sleep',
      elapsed: 1,
    })
  })

  it('非全部 sleep 不应直接结算', () => {
    const bodies = [mockBody({ sleeping: true }), mockBody({ sleeping: false, speed: 1 })]
    expect(checkSettled(bodies, 1, state)).toBeNull()
  })

  it('低速窗口被中断后重新计时', () => {
    const bodies = [
      mockBody({ speed: 0.01, angularSpeed: 0.01 }),
      mockBody({ speed: 0.01, angularSpeed: 0.01 }),
    ]

    // 开始低速
    checkSettled(bodies, 0.1, state)
    expect(state.stableStartTime).toBe(0.1)

    // 中途速度突增
    bodies[0].velocity.set(1, 0, 0)
    checkSettled(bodies, 0.3, state)
    expect(state.stableStartTime).toBe(-1) // 重置

    // 重新低速
    bodies[0].velocity.set(0.01, 0, 0)
    checkSettled(bodies, 0.5, state)
    expect(state.stableStartTime).toBe(0.5) // 重新计时
  })

  it('空间姿态与读面持续稳定时，默认忽略速度噪声且不修改刚体', () => {
    const bodies = [mockBody({ speed: 5, angularSpeed: 10 })]
    const before = {
      position: bodies[0].position.clone(),
      quaternion: bodies[0].quaternion.clone(),
      velocity: bodies[0].velocity.clone(),
      angularVelocity: bodies[0].angularVelocity.clone(),
      sleepState: bodies[0].sleepState,
    }

    expect(checkSettled(bodies, SETTLE.poseStableWindow.activationDelay, state)).toBeNull()
    expect(
      checkSettled(
        bodies,
        SETTLE.poseStableWindow.activationDelay + SETTLE.poseStableWindow.duration,
        state,
      ),
    ).toEqual({
      reason: 'pose-stable-window',
      elapsed: SETTLE.poseStableWindow.activationDelay + SETTLE.poseStableWindow.duration,
    })

    expect(bodies[0].position.toArray()).toEqual(before.position.toArray())
    expect(bodies[0].quaternion.toArray()).toEqual(before.quaternion.toArray())
    expect(bodies[0].velocity.toArray()).toEqual(before.velocity.toArray())
    expect(bodies[0].angularVelocity.toArray()).toEqual(before.angularVelocity.toArray())
    expect(bodies[0].sleepState).toBe(before.sleepState)
  })

  it('显式禁用姿态稳定窗口时，相同姿态不会触发该结算路径', () => {
    const bodies = [mockBody({ speed: 0.06, angularSpeed: 0.06 })]
    const startedAt = SETTLE.poseStableWindow.activationDelay

    expect(checkSettled(bodies, startedAt, state, undefined, undefined, false)).toBeNull()
    expect(
      checkSettled(
        bodies,
        startedAt + SETTLE.poseStableWindow.duration,
        state,
        undefined,
        undefined,
        false,
      ),
    ).toBeNull()
    expect(state.poseStableAnchor).toBeNull()
    expect(state.poseStableBrokenCount).toBe(0)
  })

  it('姿态漂移或读面变化会打断只读窗口并重新锚定', () => {
    const bodies = [mockBody({ speed: 0.06, angularSpeed: 0.06 })]
    const startedAt = SETTLE.poseStableWindow.activationDelay
    expect(checkSettled(bodies, startedAt, state)).toBeNull()

    bodies[0].position.x += SETTLE.poseStableWindow.maxPositionDrift * 2
    expect(checkSettled(bodies, startedAt + 0.4, state)).toBeNull()
    expect(state.poseStableAnchor).toBeNull()
    expect(state.poseStableBrokenCount).toBe(1)

    bodies[0].position.x = 0
    expect(checkSettled(bodies, startedAt + 0.5, state)).toBeNull()
    bodies[0].quaternion.setFromEuler(Math.PI / 2, 0, 0)
    expect(checkSettled(bodies, startedAt + 0.9, state)).toBeNull()
    expect(state.poseStableBrokenCount).toBe(2)
  })

  it('只有一颗骰子一直未停，不应提前结算', () => {
    const bodies = [
      mockBody({ speed: 0.01, angularSpeed: 0.01 }),
      mockBody({ speed: 2, angularSpeed: 5 }), // 一颗还在动
    ]

    // 持续检测
    for (let t = 0; t < SETTLE.stableDuration + 1; t += 0.1) {
      const result = checkSettled(bodies, t, state)
      if (t < SETTLE.timeout) {
        expect(result).toBeNull()
      }
    }
  })

  it('超时兜底触发', () => {
    const bodies = [
      mockBody({ speed: 2, angularSpeed: 5 }),
      mockBody({ speed: 3, angularSpeed: 2 }),
    ]

    // 超时前不应结算
    expect(checkSettled(bodies, SETTLE.timeout - 0.1, state)).toBeNull()
    // 超时后强制结算
    expect(checkSettled(bodies, SETTLE.timeout, state)).toEqual({
      reason: 'timeout',
      elapsed: SETTLE.timeout,
    })
  })

  it('接近阈值反复抖动但不应提前结算', () => {
    const bodies = [
      mockBody({ speed: 0.01, angularSpeed: 0.01 }),
      mockBody({ speed: 0.01, angularSpeed: 0.01 }),
    ]

    let t = 0
    // 模拟反复抖动：低速 → 略超 → 低速 → 略超
    for (let cycle = 0; cycle < 5; cycle++) {
      // 低速短暂
      checkSettled(bodies, t, state)
      t += SETTLE.stableDuration * 0.3
      checkSettled(bodies, t, state)

      // 略超阈值
      bodies[0].velocity.set(SETTLE.speedThreshold + 0.01, 0, 0)
      checkSettled(bodies, t + 0.01, state)
      expect(state.stableStartTime).toBe(-1) // 每次都重置

      // 恢复低速
      bodies[0].velocity.set(0.01, 0, 0)
      t += 0.1
    }

    // 最后持续低速足够时间
    const result1 = checkSettled(bodies, t, state)
    expect(result1).toBeNull() // 刚开始不够
    const result2 = checkSettled(bodies, t + SETTLE.stableDuration, state)
    expect(result2).toEqual({
      reason: 'stable-window',
      elapsed: t + SETTLE.stableDuration,
    })
  })

  it('本轮接触簇辅助介入后使用 cluster-assist 原因', () => {
    const bodies = [mockBody({ sleeping: true }), mockBody({ sleeping: true })]
    state.contactClusterAssist.assistedClusterKeys.add('1-2')

    expect(checkSettled(bodies, 2, state)).toEqual({
      reason: 'cluster-assist',
      elapsed: 2,
    })
  })

  it('达到超时上限时 timeout 诊断优先于 sleep 或 cluster-assist', () => {
    const bodies = [mockBody({ sleeping: true })]
    state.contactClusterAssist.assistedClusterKeys.add('1-2')

    expect(checkSettled(bodies, SETTLE.timeout, state)).toEqual({
      reason: 'timeout',
      elapsed: SETTLE.timeout,
    })
  })
})
