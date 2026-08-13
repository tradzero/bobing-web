// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { PHYSICS_VARIANTS } from '@/config/physics-variants'
import { SETTLE } from '@/config/settle'
import {
  DEFAULT_PHYSICS_AB_BUDGETS,
  buildPhysicsAbSeedSet,
  createPhysicsAbExecutionPlan,
  evaluatePhysicsAbPairs,
  executePhysicsAb,
  parsePhysicsAbArgs,
  summarizeRollResults,
  type PhysicsAbPair,
} from '@/physics/roll-comparison'
import type { RollRunOptions, RollRunResult } from '@/physics/roll-runner'

function makeResult(seed: number, overrides: Partial<RollRunResult> = {}): RollRunResult {
  return {
    seed,
    maxRadius: 0.7,
    maxHeight: 1.6,
    maxSpeed: 4,
    maxAngularSpeed: 9,
    maxContactPenetration: 0.05,
    conservativeBoundaryCrossings: 0,
    wallCenterCrossings: 0,
    nanDetected: false,
    settleReason: 'natural-sleep',
    settleTime: 2,
    settleFrame: 120,
    stableBrokenCount: 0,
    poseStableBrokenCount: 0,
    assistInterventionCount: 0,
    escapeGuardInterventionCount: 0,
    sleepWakeCount: 0,
    throwDiagnostics: {
      algorithm: 'uniform-area-restarts',
      attempts: 12,
      restarts: 0,
      groupAttempts: 1,
      randomPlanVersion: 1,
      placementPath: 'rejection',
      fallbackLayout: null,
    },
    finalFaces: [1, 2, 3, 4, 5, 6].map((value) => ({ value, confidence: 1 })),
    finalRadius: 0.6,
    finalMaxSpeed: 0,
    finalMaxAngularSpeed: 0,
    ambiguousDiceCount: 0,
    faceChangedDuringStableWindow: false,
    maxStableWindowPositionDrift: 0,
    maxStableWindowAngularDrift: 0,
    longestStableWindow: 0.5,
    ...overrides,
  }
}

function makePair(
  seed: number,
  baselineOverrides: Partial<RollRunResult> = {},
  candidateOverrides: Partial<RollRunResult> = {},
): PhysicsAbPair {
  return {
    seed,
    executionOrder: seed % 2 === 0 ? 'baseline-candidate' : 'candidate-baseline',
    baseline: makeResult(seed, baselineOverrides),
    candidate: makeResult(seed, candidateOverrides),
  }
}

describe('physics A/B 参数与 preset', () => {
  it('锁定五个命名 preset 的算法、assist 与 pose detector 组合', () => {
    expect(PHYSICS_VARIANTS).toMatchObject({
      historical: {
        throwPlacementAlgorithm: 'legacy-v1',
        contactClusterAssistEnabled: true,
        poseStableWindowEnabled: false,
      },
      'placement-control': {
        throwPlacementAlgorithm: 'uniform-area-restarts',
        contactClusterAssistEnabled: false,
        poseStableWindowEnabled: false,
      },
      'placement-candidate': {
        throwPlacementAlgorithm: 'stratified-ring',
        contactClusterAssistEnabled: false,
        poseStableWindowEnabled: false,
      },
      'natural-control': {
        throwPlacementAlgorithm: 'legacy-v1',
        contactClusterAssistEnabled: false,
        poseStableWindowEnabled: false,
      },
      current: {
        throwPlacementAlgorithm: 'stratified-ring',
        contactClusterAssistEnabled: false,
        poseStableWindowEnabled: true,
      },
    })
  })

  it('默认使用 historical vs current 与 200 个总 seed', () => {
    const options = parsePhysicsAbArgs([])
    expect(options).toMatchObject({
      baseline: 'historical',
      candidate: 'current',
      seeds: 200,
      baseSeed: 50000,
      help: false,
    })
    const seeds = buildPhysicsAbSeedSet(options)
    expect(seeds).toHaveLength(200)
    expect(new Set(seeds).size).toBe(200)
    expect(seeds).toEqual(expect.arrayContaining([...options.watchSeeds]))
    expect(seeds).toEqual(expect.arrayContaining([65000, 67000, 72000, 208000, 212000, 1673000]))
  })

  it('解析命名 variant、seed 参数与空 watch 集', () => {
    expect(
      parsePhysicsAbArgs([
        '--baseline=placement-control',
        '--candidate=placement-candidate',
        '--seeds=3',
        '--base-seed=-10',
        '--watch-seeds=none',
      ]),
    ).toEqual({
      baseline: 'placement-control',
      candidate: 'placement-candidate',
      seeds: 3,
      baseSeed: -10,
      watchSeeds: [],
      help: false,
    })
  })

  it('拒绝未知、重复、无效或同名 variant 参数', () => {
    expect(() => parsePhysicsAbArgs(['--candidate=unknown'])).toThrow(/未知 physics variant/)
    expect(() => parsePhysicsAbArgs(['--seeds=0'])).toThrow(/必须大于 0/)
    expect(() => parsePhysicsAbArgs(['--seeds=2', '--seeds=3'])).toThrow(/参数重复/)
    expect(() => parsePhysicsAbArgs(['--wat=1'])).toThrow(/不支持的参数/)
    expect(() => parsePhysicsAbArgs(['--baseline=current', '--candidate=current'])).toThrow(
      /必须使用不同/,
    )
  })
})

describe('physics A/B 执行与汇总', () => {
  it('同 seed 按 A/B、B/A 交替执行且传递 preset 行为', () => {
    const plan = createPhysicsAbExecutionPlan(
      [10, 20],
      PHYSICS_VARIANTS.historical,
      PHYSICS_VARIANTS.current,
    )
    expect(plan.map(({ seed, role }) => `${seed}:${role}`)).toEqual([
      '10:baseline',
      '10:candidate',
      '20:candidate',
      '20:baseline',
    ])

    const calls: RollRunOptions[] = []
    const runner = vi.fn((options: RollRunOptions) => {
      calls.push(options)
      return makeResult(options.seed, {
        throwDiagnostics: {
          ...makeResult(options.seed).throwDiagnostics,
          algorithm: options.throwPlacementAlgorithm ?? 'stratified-ring',
        },
      })
    })
    const report = executePhysicsAb({
      seeds: [10, 20],
      baseline: PHYSICS_VARIANTS.historical,
      candidate: PHYSICS_VARIANTS.current,
      runRoll: runner,
    })

    expect(calls).toEqual([
      {
        seed: 10,
        throwPlacementAlgorithm: 'legacy-v1',
        contactClusterAssistEnabled: true,
        poseStableWindowEnabled: false,
      },
      {
        seed: 10,
        throwPlacementAlgorithm: 'stratified-ring',
        contactClusterAssistEnabled: false,
        poseStableWindowEnabled: true,
      },
      {
        seed: 20,
        throwPlacementAlgorithm: 'stratified-ring',
        contactClusterAssistEnabled: false,
        poseStableWindowEnabled: true,
      },
      {
        seed: 20,
        throwPlacementAlgorithm: 'legacy-v1',
        contactClusterAssistEnabled: true,
        poseStableWindowEnabled: false,
      },
    ])
    expect(report.diffs.map(({ executionOrder }) => executionOrder)).toEqual([
      'baseline-candidate',
      'candidate-baseline',
    ])
    expect(report.diffs.map(({ cohort }) => cohort)).toEqual(['batch', 'batch'])
  })

  it('默认 200 个总 seed 被稳定拆分为 watch 与 batch cohort', () => {
    const cliOptions = parsePhysicsAbArgs([])
    const seeds = buildPhysicsAbSeedSet(cliOptions)
    const report = executePhysicsAb({
      seeds,
      watchSeeds: cliOptions.watchSeeds,
      baseline: PHYSICS_VARIANTS.historical,
      candidate: PHYSICS_VARIANTS.current,
      runRoll: ({ seed }) => makeResult(seed),
    })

    expect(report.summary.cohorts.watch).toMatchObject({
      sampleCount: cliOptions.watchSeeds.length,
      seeds: [...cliOptions.watchSeeds],
    })
    expect(report.summary.cohorts.batch.sampleCount).toBe(200 - cliOptions.watchSeeds.length)
    expect(report.summary.cohorts.batch.seeds).not.toEqual(
      expect.arrayContaining([...cliOptions.watchSeeds]),
    )
    expect(report.diffs.filter(({ cohort }) => cohort === 'watch')).toHaveLength(
      cliOptions.watchSeeds.length,
    )
  })

  it('显式 watch 占满总 seed 时在运行前拒绝伪分布验收', () => {
    const runner = vi.fn(({ seed }: RollRunOptions) => makeResult(seed))
    expect(() =>
      executePhysicsAb({
        seeds: [10],
        watchSeeds: [10],
        baseline: PHYSICS_VARIANTS.historical,
        candidate: PHYSICS_VARIANTS.current,
        runRoll: runner,
      }),
    ).toThrow(/至少需要 1 个非 watch 的 batch seed/)
    expect(runner).not.toHaveBeenCalled()
  })

  it('仅为非自然结算追加同 seed、同算法且禁用 assist 的 continuation', () => {
    const calls: RollRunOptions[] = []
    const runner = vi.fn((options: RollRunOptions) => {
      calls.push(options)
      const isContinuation = options.settlementPolicy === 'natural-continuation'
      return makeResult(options.seed, {
        settleReason: isContinuation
          ? 'natural-sleep'
          : options.throwPlacementAlgorithm === 'legacy-v1'
            ? 'stable-window'
            : 'pose-stable-window',
        throwDiagnostics: {
          ...makeResult(options.seed).throwDiagnostics,
          algorithm: options.throwPlacementAlgorithm ?? 'stratified-ring',
        },
      })
    })

    const report = executePhysicsAb({
      seeds: [10],
      baseline: PHYSICS_VARIANTS.historical,
      candidate: PHYSICS_VARIANTS.current,
      runRoll: runner,
    })

    expect(calls).toEqual([
      {
        seed: 10,
        throwPlacementAlgorithm: 'legacy-v1',
        contactClusterAssistEnabled: true,
        poseStableWindowEnabled: false,
      },
      {
        seed: 10,
        throwPlacementAlgorithm: 'stratified-ring',
        contactClusterAssistEnabled: false,
        poseStableWindowEnabled: true,
      },
      {
        seed: 10,
        throwPlacementAlgorithm: 'legacy-v1',
        contactClusterAssistEnabled: false,
        poseStableWindowEnabled: false,
        settlementPolicy: 'natural-continuation',
        maxFrames: 1200,
      },
      {
        seed: 10,
        throwPlacementAlgorithm: 'stratified-ring',
        contactClusterAssistEnabled: false,
        poseStableWindowEnabled: false,
        settlementPolicy: 'natural-continuation',
        maxFrames: 1200,
      },
    ])
    expect(report.summary.continuations.baseline).toMatchObject({
      count: 1,
      seeds: [10],
      faceDiff: { count: 0, seeds: [] },
    })
    expect(report.summary.continuations.candidate).toMatchObject({
      count: 1,
      seeds: [10],
      faceDiff: { count: 0, seeds: [] },
    })
    expect(report.diffs[0].continuation.baseline).not.toBeNull()
    expect(report.diffs[0].continuation.candidate).not.toBeNull()
    expect(report.summary.passed).toBe(true)
  })

  it('汇总 fallback、assist、逻辑分位数与仅记录的面值/奖级分布', () => {
    const fallback = {
      ...makeResult(2).throwDiagnostics,
      placementPath: 'fallback' as const,
      fallbackLayout: 'ring6' as const,
    }
    const summary = summarizeRollResults([
      makeResult(1, { settleTime: 1, settleFrame: 60 }),
      makeResult(2, {
        settleTime: 3,
        settleFrame: 180,
        settleReason: 'cluster-assist',
        assistInterventionCount: 1,
        throwDiagnostics: fallback,
      }),
    ])

    expect(summary).toMatchObject({
      rolls: 2,
      fallbackCount: 1,
      fallbackRate: 0.5,
      assistedRollCount: 1,
      assistInterventionCount: 1,
      settleSeconds: { p50: 3, p95: 3, p99: 3, max: 3 },
      settleFrames: { p50: 180, p95: 180, p99: 180, max: 180 },
      faceCounts: { '1': 2, '2': 2, '3': 2, '4': 2, '5': 2, '6': 2 },
      sumCounts: { '21': 2 },
    })
    expect(summary.faceCountsByDie).toHaveLength(6)
    expect(summary.faceCountsByDie[0]).toMatchObject({ '1': 2 })
    expect(summary.faceCountsByDie[5]).toMatchObject({ '6': 2 })
    expect(Object.values(summary.prizeCounts).reduce((sum, count) => sum + count, 0)).toBe(2)
  })
})

describe('physics A/B 硬门禁', () => {
  it('极端 watch 长尾与 penetration 不污染 batch 分布预算', () => {
    const watch = makePair(999, {}, { settleTime: 100, maxContactPenetration: 1 })
    const batch = Array.from({ length: 20 }, (_, index) =>
      makePair(index + 1, { settleTime: 2 }, { settleTime: 2.1 }),
    )
    const report = evaluatePhysicsAbPairs(
      [watch, ...batch],
      PHYSICS_VARIANTS.historical,
      PHYSICS_VARIANTS.current,
      DEFAULT_PHYSICS_AB_BUDGETS,
      [999],
    )

    expect(report.summary.candidate.settleSeconds.p99).toBe(100)
    expect(report.summary.candidate.maxContactPenetration).toBe(1)
    expect(report.summary.cohorts.watch.sampleCount).toBe(1)
    expect(report.summary.cohorts.batch).toMatchObject({
      sampleCount: 20,
      baseline: { settleSeconds: { p99: 2 }, maxContactPenetration: 0.05 },
      candidate: { settleSeconds: { p99: 2.1 }, maxContactPenetration: 0.05 },
    })
    expect(report.summary.delta.p99SettleSeconds).toBeCloseTo(0.1)
    expect(report.summary.failures).toEqual([])
    expect(report.failureSeeds).toEqual([])
  })

  it('watch seed 的安全失败仍是硬失败', () => {
    const watch = makePair(999, {}, { nanDetected: true })
    const report = evaluatePhysicsAbPairs(
      [watch, makePair(1)],
      PHYSICS_VARIANTS.historical,
      PHYSICS_VARIANTS.current,
      DEFAULT_PHYSICS_AB_BUDGETS,
      [999],
    )

    expect(report.summary.failures).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'candidate-nan', seeds: [999] })]),
    )
    expect(report.failureSeeds).toEqual([999])
    expect(report.summary.passed).toBe(false)
  })

  it('安全失败在 baseline/candidate 任一侧都立即进入失败 seed', () => {
    const pairs = [
      makePair(1, { nanDetected: true }, { wallCenterCrossings: 1 }),
      makePair(2, {}, { escapeGuardInterventionCount: 1 }),
      makePair(3, { settleReason: 'timeout' }, {}),
      makePair(4, {}, { settleReason: 'frame-budget-exhausted', settleFrame: -1 }),
    ]
    const report = evaluatePhysicsAbPairs(
      pairs,
      PHYSICS_VARIANTS.historical,
      PHYSICS_VARIANTS.current,
    )
    const codes = report.summary.failures.map(({ code }) => code)

    expect(codes).toEqual(
      expect.arrayContaining([
        'baseline-nan',
        'candidate-wall-crossing',
        'candidate-escape-guard',
        'baseline-timeout',
        'candidate-frame-budget',
      ]),
    )
    expect(report.summary.passed).toBe(false)
    expect(report.failureSeeds).toEqual([1, 2, 3, 4])
  })

  it('candidate 强制要求 assist=0、fallback<=5% 与 penetration 上限', () => {
    const pairs = Array.from({ length: 20 }, (_, index) => makePair(index + 1))
    pairs[0].candidate = makeResult(1, {
      settleReason: 'cluster-assist',
      assistInterventionCount: 1,
      maxContactPenetration: 0.103,
      throwDiagnostics: {
        ...makeResult(1).throwDiagnostics,
        placementPath: 'fallback',
        fallbackLayout: 'dual33',
      },
    })
    pairs[1].candidate = makeResult(2, {
      throwDiagnostics: {
        ...makeResult(2).throwDiagnostics,
        placementPath: 'fallback',
        fallbackLayout: 'ring6',
      },
    })

    const report = evaluatePhysicsAbPairs(
      pairs,
      PHYSICS_VARIANTS.historical,
      PHYSICS_VARIANTS.current,
    )
    expect(report.summary.penetrationLimit).toBe(0.1)
    expect(report.summary.failures.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'candidate-assist-not-zero',
        'candidate-fallback-rate',
        'candidate-contact-penetration',
      ]),
    )
    expect(report.failureSeeds).toEqual(expect.arrayContaining([1, 2]))
  })

  it('fallback 恰好 5% 通过，并以基线 penetration+0.002 作为较宽上限', () => {
    const pairs = Array.from({ length: 20 }, (_, index) => makePair(index + 1))
    pairs[0].baseline = makeResult(1, { maxContactPenetration: 0.11 })
    pairs[0].candidate = makeResult(1, {
      maxContactPenetration: 0.112,
      throwDiagnostics: {
        ...makeResult(1).throwDiagnostics,
        placementPath: 'fallback',
        fallbackLayout: 'center15',
      },
    })

    const report = evaluatePhysicsAbPairs(
      pairs,
      PHYSICS_VARIANTS.historical,
      PHYSICS_VARIANTS.current,
    )
    expect(report.summary.candidate.fallbackRate).toBe(0.05)
    expect(report.summary.penetrationLimit).toBeCloseTo(0.112)
    expect(report.summary.passed).toBe(true)
  })

  it('p95 与 p99 只比较逻辑结算秒数，不引入 wall-clock 门槛', () => {
    const pairs = Array.from({ length: 20 }, (_, index) =>
      makePair(index + 1, { settleTime: 2 }, { settleTime: 2.8 }),
    )
    const report = evaluatePhysicsAbPairs(
      pairs,
      PHYSICS_VARIANTS.historical,
      PHYSICS_VARIANTS.current,
    )

    expect(report.summary.delta.p95SettleSeconds).toBeCloseTo(0.8)
    expect(report.summary.delta.p99SettleSeconds).toBeCloseTo(0.8)
    expect(report.summary.failures.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        'candidate-p95-settle-regression',
        'candidate-p99-settle-regression',
      ]),
    )
    expect(JSON.stringify(report)).not.toContain('wallClock')
  })

  it('baseline continuation 的耗尽、差异与安全问题只记录，不阻止 candidate', () => {
    const pair = makePair(
      208000,
      { settleReason: 'cluster-assist', assistInterventionCount: 1 },
      {},
    )
    pair.baselineContinuation = makeResult(208000, {
      settleReason: 'continuation-budget-exhausted',
      settleFrame: -1,
      nanDetected: true,
      finalFaces: [6, 6, 6, 6, 6, 6].map((value, index) => ({
        value,
        confidence: index === 0 ? SETTLE.tiltThreshold - 0.01 : 1,
      })),
    })

    const report = evaluatePhysicsAbPairs(
      [pair],
      PHYSICS_VARIANTS.historical,
      PHYSICS_VARIANTS.current,
    )

    expect(report.summary.continuations.baseline).toMatchObject({
      count: 1,
      seeds: [208000],
      missing: { count: 0, seeds: [] },
      exhausted: { count: 1, seeds: [208000] },
      faceDiff: { count: 1, seeds: [208000] },
      tiltDiff: { count: 1, seeds: [208000] },
      prizeDiff: { count: 1, seeds: [208000] },
      safety: { count: 1, seeds: [208000], nanSeeds: [208000] },
    })
    expect(report.summary.failures).toEqual([])
    expect(report.failureSeeds).toEqual([])
    expect(report.summary.passed).toBe(true)
  })

  it('candidate continuation 对缺失、逐骰结果差异及轨迹安全做硬失败', () => {
    const pairs = Array.from({ length: 5 }, (_, index) =>
      makePair(index + 1, {}, { settleReason: 'pose-stable-window' }),
    )
    pairs[0].candidateContinuation = makeResult(1, {
      finalFaces: [6, 6, 6, 6, 6, 6].map((value) => ({ value, confidence: 1 })),
    })
    pairs[1].candidateContinuation = makeResult(2, {
      finalFaces: makeResult(2).finalFaces.map((face, index) => ({
        ...face,
        confidence: index === 0 ? SETTLE.tiltThreshold - 0.01 : face.confidence,
      })),
    })
    pairs[2].candidateContinuation = makeResult(3, {
      nanDetected: true,
      wallCenterCrossings: 1,
      escapeGuardInterventionCount: 1,
    })
    // seed 4 故意缺少 candidateContinuation，验证不能绕过真实性门禁。
    pairs[4].candidateContinuation = makeResult(5, {
      settleReason: 'continuation-budget-exhausted',
      settleFrame: -1,
    })

    const report = evaluatePhysicsAbPairs(
      pairs,
      PHYSICS_VARIANTS.historical,
      PHYSICS_VARIANTS.current,
    )
    const codes = report.summary.failures.map(({ code }) => code)

    expect(codes).toEqual(
      expect.arrayContaining([
        'candidate-continuation-missing',
        'candidate-continuation-face-diff',
        'candidate-continuation-tilt-diff',
        'candidate-continuation-prize-diff',
        'candidate-continuation-nan',
        'candidate-continuation-wall-crossing',
        'candidate-continuation-escape-guard',
      ]),
    )
    expect(report.summary.continuations.candidate).toMatchObject({
      count: 4,
      seeds: [1, 2, 3, 5],
      missing: { count: 1, seeds: [4] },
      exhausted: { count: 1, seeds: [5] },
      faceDiff: { count: 1, seeds: [1] },
      tiltDiff: { count: 1, seeds: [2] },
      prizeDiff: { count: 1, seeds: [1] },
      safety: {
        count: 1,
        seeds: [3],
        nanSeeds: [3],
        wallCrossingSeeds: [3],
        escapeGuardSeeds: [3],
      },
    })
    expect(report.failureSeeds).toEqual([1, 2, 3, 4])
    expect(report.summary.passed).toBe(false)
  })
})
