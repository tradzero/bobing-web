// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  CADENCE_DEFAULT_BASE_SEED,
  CADENCE_NORMAL_IDS,
  CADENCE_WATCH_SEEDS,
  createCadenceComparisonPlan,
  executeCadenceComparison,
} from '@/physics/cadence-comparison'
import { parsePhysicsCadenceArgs } from '@/physics/cadence-cli-options'
import type { CadenceRollOptions, CadenceRollReport } from '@/physics/cadence-roll-runner'
import type { RollRunResult } from '@/physics/roll-runner'

function canonicalState(seed: number) {
  return {
    version: 1 as const,
    floatEncoding: 'ieee754-float64-be' as const,
    hashAlgorithm: 'fnv1a64' as const,
    hash: seed.toString(16).padStart(16, '0'),
    bodies: Array.from({ length: 6 }, (_, index) => ({
      position: [seed + index, 0, 0] as const,
      quaternion: [0, 0, 0, 1] as const,
      velocity: [0, 0, 0] as const,
      angularVelocity: [0, 0, 0] as const,
    })),
  }
}

function floorRelaunch() {
  return {
    version: 1 as const,
    available: true,
    unavailableReason: null,
    initialContactObservedDiceCount: 6,
    armedDiceCount: 6,
    secondaryEpisodeCount: 0,
    floorOnlySecondaryEpisodeCount: 0,
    relaunchEventCount: 0,
    maxFloorOnlySecondaryClearance: 0,
    maxFloorOnlySecondaryOrderedWorldYRise: 0,
    maxPreExternalSecondaryClearance: 0,
    maxPreExternalSecondaryOrderedWorldYRise: 0,
    legacyUnorderedPost100WorldYRange: 0,
    events: [],
  }
}

function roll(seed: number): RollRunResult {
  return {
    seed,
    maxRadius: 0.5,
    maxHeight: 1.5,
    maxSpeed: 4,
    maxAngularSpeed: 8,
    maxContactPenetration: 0.05,
    conservativeBoundaryCrossings: 0,
    wallCenterCrossings: 0,
    nanDetected: false,
    settleReason: 'natural-sleep',
    settleTime: 1,
    simulationStep: 60,
    simulationTime: 1,
    settleFrame: 60,
    stableBrokenCount: 0,
    poseStableBrokenCount: 0,
    assistInterventionCount: 0,
    escapeGuardInterventionCount: 0,
    sleepWakeCount: 0,
    throwDiagnostics: {
      algorithm: 'stratified-ring',
      attempts: 0,
      restarts: 0,
      groupAttempts: 1,
      randomPlanVersion: 1,
      placementPath: 'constructive',
      fallbackLayout: null,
    },
    finalFaces: [1, 2, 3, 4, 5, 6].map((value) => ({ value, confidence: 1 })),
    finalState: canonicalState(seed + 1),
    finalRadius: 0.4,
    finalMaxSpeed: 0,
    finalMaxAngularSpeed: 0,
    ambiguousDiceCount: 0,
    faceChangedDuringStableWindow: false,
    maxStableWindowPositionDrift: 0,
    maxStableWindowAngularDrift: 0,
    longestStableWindow: 0.5,
    floorRelaunch: floorRelaunch(),
  }
}

function timing(executedSteps: number, queuedMs = 0) {
  const overload = queuedMs > 250
  return {
    version: 1 as const,
    fixedStepMs: 1000 / 60,
    maxAcceptedWallDeltaMs: 100,
    overload: { active: overload, highWaterMs: 250 },
    totalFrameCount: overload ? 6 : executedSteps,
    totalRawWallDeltaMs: overload ? 600 : executedSteps * (1000 / 60) + queuedMs,
    totalAcceptedWallDeltaMs: overload ? 600 : executedSteps * (1000 / 60) + queuedMs,
    totalPausedWallDeltaMs: 0,
    totalDiscardedWallDeltaMs: 0,
    totalExecutedSteps: executedSteps,
    totalExecutedSimulationMs: executedSteps * (1000 / 60),
    frameInProgress: false,
    queuedMs,
    queuedSteps: queuedMs / (1000 / 60),
    queuedWholeSteps: Math.floor(queuedMs / (1000 / 60)),
    interpolationAlpha: queuedMs > 0 ? 1 : 0,
  }
}

function settledReport(options: CadenceRollOptions): CadenceRollReport {
  const result = roll(options.seed)
  return {
    schemaVersion: 1,
    seed: options.seed,
    cadence: { id: options.cadence, version: 1 },
    scheduler: {
      id: options.scheduler,
      version: 1,
      maxStepsPerFrame:
        options.scheduler === 'reference-exact' ? null : options.scheduler === 'exact-cap6' ? 6 : 4,
    },
    initialState: canonicalState(options.seed),
    throwDiagnostics: result.throwDiagnostics,
    frames: [],
    timing: timing(60),
    abandonedBacklog: {
      queuedMs: 0,
      queuedSteps: 0,
      queuedWholeSteps: 0,
      interpolationAlpha: 0,
      countedAsDiscarded: false,
    },
    conservation: {
      version: 1,
      passed: true,
      frameToleranceMs: 1e-7,
      totalToleranceMs: 1e-6,
      maxFrameRawBalanceErrorMs: 0,
      maxFrameDiscardBalanceErrorMs: 0,
      maxFrameQueueBalanceErrorMs: 0,
      totalRawBalanceErrorMs: 0,
      totalQueueBalanceErrorMs: 0,
    },
    outcome: 'settled',
    roll: result,
    partialDiagnostics: null,
  }
}

function overloadReport(options: CadenceRollOptions): CadenceRollReport {
  const queuedMs = 800 / 3
  const base = settledReport(options)
  const partial = roll(options.seed)
  const priorFrames = Array.from({ length: 5 }, (_, index) => ({
    version: 1 as const,
    rawWallDeltaMs: 100,
    acceptedWallDeltaMs: 100,
    pausedWallDeltaMs: 0,
    discardedWallDeltaMs: 0,
    discardedByClampMs: 0,
    discardedByPauseMs: 0,
    discardedByOverloadMs: 0,
    availableSteps: 6 + index * 2,
    maxExecutableSteps: 4,
    queuedMs: (index + 1) * (100 / 3),
    queuedSteps: (index + 1) * 2,
    queuedWholeSteps: (index + 1) * 2,
    interpolationAlpha: 1,
    overload: { active: false, enteredThisFrame: false, highWaterMs: 250 },
    executedSteps: 4,
    executedSimulationMs: 200 / 3,
    frameIndex: index + 1,
    cadenceFrameIndex: index,
    queueBeforeMs: index * (100 / 3),
    settledAtSimulationStep: null,
    unexecutedPlannedSteps: 0,
    terminalKind: null,
  }))
  return {
    ...base,
    frames: [
      ...priorFrames,
      {
        version: 1,
        rawWallDeltaMs: 100,
        acceptedWallDeltaMs: 100,
        pausedWallDeltaMs: 0,
        discardedWallDeltaMs: 0,
        discardedByClampMs: 0,
        discardedByPauseMs: 0,
        discardedByOverloadMs: 0,
        availableSteps: 16,
        maxExecutableSteps: 0,
        queuedMs,
        queuedSteps: 16,
        queuedWholeSteps: 16,
        interpolationAlpha: 1,
        overload: { active: true, enteredThisFrame: true, highWaterMs: 250 },
        executedSteps: 0,
        executedSimulationMs: 0,
        frameIndex: 6,
        cadenceFrameIndex: 5,
        queueBeforeMs: 500 / 3,
        settledAtSimulationStep: null,
        unexecutedPlannedSteps: 0,
        terminalKind: 'timing-overload',
      },
    ],
    timing: timing(20, queuedMs),
    abandonedBacklog: {
      queuedMs,
      queuedSteps: 16,
      queuedWholeSteps: 16,
      interpolationAlpha: 1,
      countedAsDiscarded: false,
    },
    outcome: 'timing-overload',
    roll: null,
    partialDiagnostics: {
      maxRadius: partial.maxRadius,
      maxHeight: partial.maxHeight,
      maxSpeed: partial.maxSpeed,
      maxAngularSpeed: partial.maxAngularSpeed,
      maxContactPenetration: partial.maxContactPenetration,
      conservativeBoundaryCrossings: 0,
      wallCenterCrossings: 0,
      nanDetected: false,
      simulationStep: 20,
      simulationTime: 1 / 3,
      stableBrokenCount: 0,
      poseStableBrokenCount: 0,
      assistInterventionCount: 0,
      escapeGuardInterventionCount: 0,
      sleepWakeCount: 0,
      faceChangedDuringStableWindow: false,
      maxStableWindowPositionDrift: 0,
      maxStableWindowAngularDrift: 0,
      longestStableWindow: 0,
      floorRelaunch: floorRelaunch(),
    },
  }
}

describe('cadence comparison execution plan', () => {
  it('默认 200 是含 20 watch 的总数，并按约定生成 780 个串行 run', () => {
    const plan = createCadenceComparisonPlan({
      totalSeeds: 200,
      baseSeed: CADENCE_DEFAULT_BASE_SEED,
      watchOnly: false,
    })

    expect(plan.watchSeeds).toEqual(CADENCE_WATCH_SEEDS)
    expect(plan.watchSeeds).toContain(25_042)
    expect(plan.batchSeeds).toHaveLength(180)
    expect(plan.totalSeeds).toBe(200)
    expect(plan.comparisonCount).toBe(560)
    expect(plan.expectedRunCount).toBe(780)
    expect(plan.executions).toHaveLength(780)

    for (const seed of plan.watchSeeds) {
      const runs = plan.executions.filter((execution) => execution.seed === seed)
      expect(runs.filter(({ role }) => role === 'reference')).toHaveLength(1)
      expect(runs.filter(({ role }) => role === 'candidate')).toHaveLength(10)
      expect(runs.filter(({ role }) => role === 'overload')).toHaveLength(1)
    }
    for (const seed of plan.batchSeeds) {
      const runs = plan.executions.filter((execution) => execution.seed === seed)
      expect(runs.filter(({ role }) => role === 'reference')).toHaveLength(1)
      expect(runs.filter(({ role }) => role === 'candidate')).toHaveLength(2)
      expect(
        new Set(runs.filter(({ role }) => role === 'candidate').map(({ cadence }) => cadence)),
      ).toHaveLength(1)
    }
    const batchCadenceCounts = Object.fromEntries(
      CADENCE_NORMAL_IDS.map((cadence) => [
        cadence,
        new Set(
          plan.executions
            .filter(
              (execution) =>
                execution.cohort === 'batch-normal' &&
                execution.role === 'candidate' &&
                execution.cadence === cadence,
            )
            .map(({ seed }) => seed),
        ).size,
      ]),
    )
    expect(Object.values(batchCadenceCounts)).toEqual([36, 36, 36, 36, 36])
  })

  it('watch-only 与单 seed 不允许通过参数削弱 versioned matrix', () => {
    const watch = createCadenceComparisonPlan({
      totalSeeds: 200,
      baseSeed: 50_000,
      watchOnly: true,
    })
    expect(watch.watchSeeds).toEqual(CADENCE_WATCH_SEEDS)
    expect(watch.batchSeeds).toEqual([])
    expect(watch.expectedRunCount).toBe(240)

    const single = createCadenceComparisonPlan({
      totalSeeds: 200,
      baseSeed: 50_000,
      watchOnly: false,
      seed: 25_042,
    })
    expect(single.watchSeeds).toEqual([25_042])
    expect(single.batchSeeds).toEqual([])
    expect(single.expectedRunCount).toBe(12)
  })
})

describe('physics cadence CLI options', () => {
  it('解析默认值和单 seed/output/clean flags', () => {
    expect(parsePhysicsCadenceArgs([])).toMatchObject({
      totalSeeds: 200,
      baseSeed: 50_000,
      watchOnly: false,
      json: false,
      requireClean: false,
      help: false,
    })
    expect(
      parsePhysicsCadenceArgs([
        '--seed=25042',
        '--base-seed=60000',
        '--json',
        '--output=artifacts/cadence/single.json',
        '--require-clean',
      ]),
    ).toMatchObject({
      seed: 25_042,
      baseSeed: 60_000,
      json: true,
      output: 'artifacts/cadence/single.json',
      requireClean: true,
    })
  })

  it('拒绝削弱矩阵的未知参数、重复参数与冲突 seed 模式', () => {
    expect(() => parsePhysicsCadenceArgs(['--cadence=steady60'])).toThrow('不支持的参数')
    expect(() => parsePhysicsCadenceArgs(['--seeds=20', '--seeds=30'])).toThrow('参数重复')
    expect(() => parsePhysicsCadenceArgs(['--seed=1', '--watch-only'])).toThrow('不能同时使用')
    expect(() => parsePhysicsCadenceArgs(['--seed=1', '--seeds=20'])).toThrow('不能同时使用')
    expect(() => parsePhysicsCadenceArgs(['--json=true'])).toThrow('不接受值')
  })
})

describe('cadence comparison evaluator', () => {
  it('串行复用每 seed 一次 reference，并分离 normal/overload cohorts', () => {
    const plan = createCadenceComparisonPlan({
      totalSeeds: 200,
      baseSeed: 50_000,
      watchOnly: false,
      seed: 25_042,
    })
    const calls: CadenceRollOptions[] = []
    const report = executeCadenceComparison({
      plan,
      runCadenceRoll(options) {
        calls.push(options)
        return options.cadence === 'sustained100ms'
          ? overloadReport(options)
          : settledReport(options)
      },
    })

    expect(calls).toHaveLength(12)
    expect(report.summary).toMatchObject({
      passed: true,
      expectedRunCount: 12,
      actualRunCount: 12,
      comparisonCount: 10,
      overloadCheckCount: 1,
      failureCount: 0,
    })
    expect(report.cohorts['watch-normal']).toMatchObject({
      seedCount: 1,
      comparisonCount: 10,
      passedCount: 10,
      failedCount: 0,
    })
    expect(report.cohorts['watch-normal'].candidateGroups).toHaveLength(10)
    expect(report.cohorts['watch-normal'].candidateGroups[0]).toMatchObject({
      sampleCount: 1,
      excludedFailedCount: 0,
      queueMs: { p50: 0, p95: 0, max: 0 },
      abandonedQueuedMs: { p50: 0, p95: 0, max: 0 },
      wallTotalsMs: { paused: 0, discarded: 0 },
      maxConservationErrorMs: 0,
    })
    expect(report.cohorts['watch-overload']).toMatchObject({
      seedCount: 1,
      comparisonCount: 1,
      passedCount: 1,
    })
    expect(report.comparisons.every(({ equal }) => Object.values(equal).every(Boolean))).toBe(true)
  })

  it('候选即使与 reference 同样不安全也失败，且精确区分终态/roll diff', () => {
    const plan = createCadenceComparisonPlan({
      totalSeeds: 200,
      baseSeed: 50_000,
      watchOnly: false,
      seed: 25_042,
    })
    const report = executeCadenceComparison({
      plan,
      runCadenceRoll(options) {
        if (options.cadence === 'sustained100ms') return overloadReport(options)
        const result = settledReport(options)
        if (result.outcome !== 'settled') throw new Error('fixture')
        if (options.scheduler !== 'reference-exact') result.roll.nanDetected = true
        if (options.scheduler === 'exact-cap4') {
          result.roll.finalState = canonicalState(options.seed + 99)
        }
        return result
      },
    })

    expect(report.summary.passed).toBe(false)
    expect(report.failures.some(({ code }) => code === 'safety-nan')).toBe(true)
    expect(report.failures.some(({ code }) => code === 'final-state-diff')).toBe(true)
    expect(report.failures.some(({ code }) => code === 'roll-result-diff')).toBe(true)
    expect(report.failureSeeds).toEqual([25_042])
  })

  it('run error 被记录后继续剩余矩阵，不伪造正常结果', () => {
    const plan = createCadenceComparisonPlan({
      totalSeeds: 200,
      baseSeed: 50_000,
      watchOnly: false,
      seed: 25_042,
    })
    let calls = 0
    const report = executeCadenceComparison({
      plan,
      runCadenceRoll(options) {
        calls++
        if (options.scheduler === 'exact-cap6') throw new Error('mock exact failure')
        return options.cadence === 'sustained100ms'
          ? overloadReport(options)
          : settledReport(options)
      },
    })

    expect(calls).toBe(plan.expectedRunCount)
    expect(report.summary.actualRunCount).toBe(plan.expectedRunCount)
    expect(report.failures.filter(({ code }) => code === 'candidate-run-error')).toHaveLength(5)
    expect(report.comparisons.filter(({ passed }) => !passed)).toHaveLength(5)
    expect(
      report.cohorts['watch-normal'].candidateGroups
        .filter(({ scheduler }) => scheduler === 'exact-cap6')
        .every(
          ({ sampleCount, excludedFailedCount }) => sampleCount === 0 && excludedFailedCount === 1,
        ),
    ).toBe(true)
  })

  it('reference safety 失败会传播到同 seed 所有 comparison 与 cohort', () => {
    const plan = createCadenceComparisonPlan({
      totalSeeds: 200,
      baseSeed: 50_000,
      watchOnly: false,
      seed: 25_042,
    })
    const report = executeCadenceComparison({
      plan,
      runCadenceRoll(options) {
        if (options.cadence === 'sustained100ms') return overloadReport(options)
        const result = settledReport(options)
        if (result.outcome === 'settled' && options.scheduler === 'reference-exact') {
          result.roll.escapeGuardInterventionCount = 1
        }
        return result
      },
    })

    expect(report.comparisons).toHaveLength(10)
    expect(report.comparisons.every(({ passed }) => !passed)).toBe(true)
    expect(
      report.comparisons.every(({ failureCodes }) => failureCodes.includes('reference-run-error')),
    ).toBe(true)
    expect(report.cohorts['watch-normal'].failedCount).toBe(10)
  })

  it('非法骰面只记 gate failure，不会让 judge 抛错中止矩阵', () => {
    const plan = createCadenceComparisonPlan({
      totalSeeds: 200,
      baseSeed: 50_000,
      watchOnly: false,
      seed: 25_042,
    })
    let calls = 0
    const report = executeCadenceComparison({
      plan,
      runCadenceRoll(options) {
        calls++
        if (options.cadence === 'sustained100ms') return overloadReport(options)
        const result = settledReport(options)
        if (result.outcome === 'settled' && options.scheduler === 'exact-cap4') {
          result.roll.finalFaces[0].value = 7
        }
        return result
      },
    })

    expect(calls).toBe(plan.expectedRunCount)
    expect(report.failures.some(({ code }) => code === 'safety-invalid-faces')).toBe(true)
  })
})
