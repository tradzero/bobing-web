// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  PHYSICS_CADENCE_FIXED_STEP_MS,
  PHYSICS_CADENCE_IDS,
  PHYSICS_CADENCE_SCHEMA_VERSION,
  PHYSICS_CADENCE_SCHEDULER_IDS,
  getPhysicsCadence,
  getPhysicsCadenceFrame,
  getPhysicsCadenceScheduler,
  type PhysicsCadenceId,
} from '@/config/physics-cadence'
import { judge } from '@/rules/judge'
import type { SettleResult } from '@/dice/settle'
import {
  CADENCE_ROLL_REPORT_SCHEMA_VERSION,
  runCadenceRoll,
  type CadenceRollReport,
  type SettledCadenceRollReport,
} from '@/physics/cadence-roll-runner'
import { createHeadlessRollSimulation, runRoll } from '@/physics/roll-runner'

const NORMAL_CADENCES: readonly PhysicsCadenceId[] = [
  'steady60',
  'steady30',
  'deterministic-jitter',
  'isolated100ms',
  'visibility-suspend',
]

function requireSettled(report: CadenceRollReport): asserts report is SettledCadenceRollReport {
  expect(report.outcome).toBe('settled')
  if (report.outcome !== 'settled') {
    throw new Error(`预期正常结算，实际 ${report.outcome}`)
  }
}

function faceValues(report: SettledCadenceRollReport): number[] {
  return report.roll.finalFaces.map(({ value }) => value)
}

describe('versioned physics cadence definitions', () => {
  it('固定发布六种 cadence 与三种 exact scheduler', () => {
    expect(PHYSICS_CADENCE_SCHEMA_VERSION).toBe(1)
    expect(PHYSICS_CADENCE_IDS).toEqual([
      'steady60',
      'steady30',
      'deterministic-jitter',
      'isolated100ms',
      'visibility-suspend',
      'sustained100ms',
    ])
    expect(PHYSICS_CADENCE_SCHEDULER_IDS).toEqual(['reference-exact', 'exact-cap6', 'exact-cap4'])
    expect(getPhysicsCadenceScheduler('reference-exact').maxStepsPerFrame).toBeNull()
    expect(getPhysicsCadenceScheduler('exact-cap6').maxStepsPerFrame).toBe(6)
    expect(getPhysicsCadenceScheduler('exact-cap4').maxStepsPerFrame).toBe(4)
  })

  it('isolated burst 与 visibility suspend 都有显式 drain/resume 帧', () => {
    const isolated = getPhysicsCadence('isolated100ms')
    expect(getPhysicsCadenceFrame(isolated, 0)).toEqual({ rawWallDeltaMs: 100, paused: false })
    expect(getPhysicsCadenceFrame(isolated, 1)).toEqual({ rawWallDeltaMs: 0, paused: false })
    expect(getPhysicsCadenceFrame(isolated, 2)).toEqual({
      rawWallDeltaMs: PHYSICS_CADENCE_FIXED_STEP_MS,
      paused: false,
    })

    const visibility = getPhysicsCadence('visibility-suspend')
    expect(getPhysicsCadenceFrame(visibility, 0)).toEqual({
      rawWallDeltaMs: 100,
      paused: false,
    })
    expect(getPhysicsCadenceFrame(visibility, 1)).toEqual({
      rawWallDeltaMs: 5_000,
      paused: true,
    })
    expect(getPhysicsCadenceFrame(visibility, 2)).toEqual({
      rawWallDeltaMs: 0,
      paused: false,
    })
  })
})

describe('headless roll lifecycle seam', () => {
  it('防御复制 throw initial-state，并拒绝伪造 settled termination', () => {
    const simulation = createHeadlessRollSimulation({ seed: 25_042 })

    try {
      const first = simulation.getInitialState()
      const originalX = first.bodies[0].position[0]
      Reflect.set(first.bodies[0].position, 0, originalX + 1)
      expect(simulation.getInitialState().bodies[0].position[0]).toBe(originalX)

      const snapshot = simulation.snapshot()
      expect(() =>
        simulation.finishRoll({
          settleReason: 'natural-sleep',
          settleTime: snapshot.simulationTime,
          settleFrame: snapshot.simulationStep,
        }),
      ).toThrow('settled termination 与 session 状态不一致')
      expect(() =>
        simulation.finishRoll({
          settleReason: 'continuation-budget-exhausted',
          settleTime: snapshot.simulationTime,
          settleFrame: -1,
        }),
      ).toThrow('budget termination 与 session 状态不一致')

      const budget = simulation.finishRoll({
        settleReason: 'frame-budget-exhausted',
        settleTime: snapshot.simulationTime,
        settleFrame: -1,
      })
      expect(budget).toMatchObject({
        settleReason: 'frame-budget-exhausted',
        settleFrame: -1,
        simulationStep: 0,
        simulationTime: 0,
      })
    } finally {
      simulation.dispose()
    }
  })

  it('natural-continuation 只接受对应的 continuation budget reason', () => {
    const simulation = createHeadlessRollSimulation({
      seed: 25_042,
      settlementPolicy: 'natural-continuation',
    })

    try {
      const snapshot = simulation.snapshot()
      expect(() =>
        simulation.finishRoll({
          settleReason: 'frame-budget-exhausted',
          settleTime: snapshot.simulationTime,
          settleFrame: -1,
        }),
      ).toThrow('budget termination 与 session 状态不一致')

      expect(
        simulation.finishRoll({
          settleReason: 'continuation-budget-exhausted',
          settleTime: snapshot.simulationTime,
          settleFrame: -1,
        }),
      ).toMatchObject({
        settleReason: 'continuation-budget-exhausted',
        settleFrame: -1,
      })
    } finally {
      simulation.dispose()
    }
  })

  it('返回的 terminal settle 被篡改也不能污染私有 canonical terminal', () => {
    const simulation = createHeadlessRollSimulation({ seed: 25_042 })

    try {
      let returnedTerminal: SettleResult | null = null
      for (let step = 0; step < 1_000 && !returnedTerminal; step++) {
        returnedTerminal = simulation.advanceExactStep().settled
      }
      expect(returnedTerminal).not.toBeNull()
      if (!returnedTerminal) throw new Error('seed 25042 未在预期预算内停稳')

      const canonicalReason = returnedTerminal.reason
      const terminalSnapshot = simulation.snapshot()
      returnedTerminal.reason =
        canonicalReason === 'natural-sleep' ? 'stable-window' : 'natural-sleep'

      expect(() =>
        simulation.finishRoll({
          settleReason: returnedTerminal!.reason,
          settleTime: returnedTerminal!.elapsed,
          settleFrame: terminalSnapshot.simulationStep,
        }),
      ).toThrow('settled termination 与 session 状态不一致')

      expect(
        simulation.finishRoll({
          settleReason: canonicalReason,
          settleTime: terminalSnapshot.simulationTime,
          settleFrame: terminalSnapshot.simulationStep,
        }),
      ).toMatchObject({
        settleReason: canonicalReason,
        settleTime: terminalSnapshot.simulationTime,
        settleFrame: terminalSnapshot.simulationStep,
      })
    } finally {
      simulation.dispose()
    }
  })
})

describe('headless cadence roll runner', () => {
  it('seed 25042 reference-exact 保持 step460、骰面和直接 runner 结果', () => {
    const direct = runRoll({ seed: 25_042 })
    const reference = runCadenceRoll({
      seed: 25_042,
      cadence: 'steady60',
      scheduler: 'reference-exact',
    })

    requireSettled(reference)
    expect(reference.schemaVersion).toBe(CADENCE_ROLL_REPORT_SCHEMA_VERSION)
    expect(reference.roll).toEqual(direct)
    expect(reference.roll).toMatchObject({
      settleReason: 'natural-sleep',
      settleFrame: 460,
      simulationStep: 460,
      nanDetected: false,
      wallCenterCrossings: 0,
      conservativeBoundaryCrossings: 0,
      escapeGuardInterventionCount: 0,
      assistInterventionCount: 0,
    })
    expect(faceValues(reference)).toEqual([2, 1, 2, 1, 4, 5])
    expect(reference.conservation.passed).toBe(true)
  })

  it.each([1, 13, 42, 25_042])(
    'seed %s: 正常 cadence/cap 与 reference 的初态、终态、判奖及安全事实完全一致',
    { timeout: 60_000 },
    (seed) => {
      const reference = runCadenceRoll({
        seed,
        cadence: 'steady60',
        scheduler: 'reference-exact',
      })
      requireSettled(reference)

      for (const cadence of NORMAL_CADENCES) {
        for (const scheduler of ['exact-cap6', 'exact-cap4'] as const) {
          const candidate = runCadenceRoll({ seed, cadence, scheduler })
          requireSettled(candidate)
          const context = `${cadence}/${scheduler}`

          expect(candidate.initialState, `${context} initial-state`).toEqual(reference.initialState)
          // 同一 exact-step 行为链应逐字段相等；这同时覆盖安全包络、settle 原因与步数。
          expect(candidate.roll, `${context} roll`).toEqual(reference.roll)
          expect(judge(faceValues(candidate)), `${context} judge`).toEqual(
            judge(faceValues(reference)),
          )
          expect(candidate.conservation.passed, `${context} conservation`).toBe(true)
        }
      }
    },
  )

  it('isolated 100ms/cap4 先留下两步 backlog，再由显式 0ms 帧排空', () => {
    const report = runCadenceRoll({
      seed: 25_042,
      cadence: 'isolated100ms',
      scheduler: 'exact-cap4',
      maxRenderFrames: 2,
    })

    expect(report.outcome).toBe('frame-budget-exhausted')
    expect(report.frames).toHaveLength(2)
    expect(report.frames[0]).toMatchObject({
      rawWallDeltaMs: 100,
      acceptedWallDeltaMs: 100,
      availableSteps: 6,
      executedSteps: 4,
      queuedWholeSteps: 2,
    })
    expect(report.frames[1]).toMatchObject({
      rawWallDeltaMs: 0,
      acceptedWallDeltaMs: 0,
      availableSteps: 2,
      executedSteps: 2,
      queuedMs: 0,
    })
    expect(report.timing.totalExecutedSteps).toBe(6)
    expect(report.conservation.passed).toBe(true)
  })

  it('visibility hidden 时间只记 paused/discarded，不接纳为模拟 backlog', () => {
    const report = runCadenceRoll({
      seed: 25_042,
      cadence: 'visibility-suspend',
      scheduler: 'exact-cap4',
      maxRenderFrames: 3,
    })

    expect(report.outcome).toBe('frame-budget-exhausted')
    expect(report.frames[0]).toMatchObject({
      acceptedWallDeltaMs: 100,
      executedSteps: 4,
      queuedWholeSteps: 2,
    })
    expect(report.frames[1]).toMatchObject({
      rawWallDeltaMs: 5_000,
      acceptedWallDeltaMs: 0,
      pausedWallDeltaMs: 5_000,
      discardedWallDeltaMs: 5_000,
      discardedByPauseMs: 5_000,
      executedSteps: 0,
      queuedWholeSteps: 2,
    })
    expect(report.frames[2]).toMatchObject({
      rawWallDeltaMs: 0,
      acceptedWallDeltaMs: 0,
      availableSteps: 2,
      executedSteps: 2,
      queuedMs: 0,
    })
    expect(report.timing).toMatchObject({
      totalAcceptedWallDeltaMs: 100,
      totalPausedWallDeltaMs: 5_000,
      totalExecutedSteps: 6,
    })
    expect(report.conservation.passed).toBe(true)
  })

  it('持续 100ms/cap4 在第六帧越过 250ms 高水位并明确 timing-overload', () => {
    const report = runCadenceRoll({
      seed: 25_042,
      cadence: 'sustained100ms',
      scheduler: 'exact-cap4',
      maxRenderFrames: 10,
    })

    expect(report.outcome).toBe('timing-overload')
    expect(report.roll).toBeNull()
    expect(report.frames).toHaveLength(6)
    expect(report.timing.totalExecutedSteps).toBe(20)
    expect(report.frames[5]).toMatchObject({
      frameIndex: 6,
      rawWallDeltaMs: 100,
      acceptedWallDeltaMs: 100,
      maxExecutableSteps: 0,
      executedSteps: 0,
      overload: { active: true, enteredThisFrame: true, highWaterMs: 250 },
    })
    expect(report.frames[5].queuedMs).toBeCloseTo(800 / 3, 10)
    expect(report.abandonedBacklog.queuedMs).toBeCloseTo(800 / 3, 10)
    expect(report.abandonedBacklog.countedAsDiscarded).toBe(false)
    expect(report.timing.totalDiscardedWallDeltaMs).toBe(0)
    expect(report.conservation.passed).toBe(true)
  })

  it('mid-frame settle 只消费已完成步，并把其余 terminal queue 记作 abandoned', () => {
    const report = runCadenceRoll({
      seed: 25_042,
      cadence: 'sustained100ms',
      scheduler: 'exact-cap6',
    })

    requireSettled(report)
    expect(report.roll.simulationStep).toBe(460)
    expect(report.frames.at(-1)).toMatchObject({
      availableSteps: 6,
      maxExecutableSteps: 6,
      executedSteps: 4,
      settledAtSimulationStep: 460,
      queuedWholeSteps: 2,
      unexecutedPlannedSteps: 2,
      terminalKind: 'settled',
    })
    expect(report.abandonedBacklog.queuedWholeSteps).toBe(2)
    expect(report.abandonedBacklog.countedAsDiscarded).toBe(false)
    expect(report.timing.totalDiscardedWallDeltaMs).toBe(0)
    expect(report.conservation.passed).toBe(true)
  })

  it('schedule 帧预算耗尽是硬失败，不隐式追加 0ms drain 或正常结果', () => {
    const report = runCadenceRoll({
      seed: 25_042,
      cadence: 'steady60',
      scheduler: 'reference-exact',
      maxRenderFrames: 1,
    })

    expect(report).toMatchObject({
      outcome: 'frame-budget-exhausted',
      roll: null,
      frames: [
        {
          frameIndex: 1,
          executedSteps: 1,
          terminalKind: 'frame-budget-exhausted',
        },
      ],
    })
    if (report.outcome === 'settled') throw new Error('帧预算耗尽不得正常结算')
    expect(report.partialDiagnostics.simulationStep).toBe(1)
    expect(report.conservation.passed).toBe(true)
  })
})
