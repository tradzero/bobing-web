import { describe, expect, it } from 'vitest'
import { createFixedStepAccumulator } from '@/game/fixed-step-accumulator'

const FIXED_STEP_MS = 1000 / 60

function createAccumulator(overloadHighWaterMs = 250) {
  return createFixedStepAccumulator({ fixedStepMs: FIXED_STEP_MS, overloadHighWaterMs })
}

function executePlan(
  accumulator: ReturnType<typeof createAccumulator>,
  input: { rawWallDeltaMs: number; paused: boolean; maxSteps: number },
  steps?: number,
) {
  const plan = accumulator.planFrame(input)
  const executedSteps = steps ?? plan.maxExecutableSteps
  for (let step = 0; step < executedSteps; step++) accumulator.consumeStep()
  return accumulator.finishFrame()
}

describe('fixed-step backlog accumulator', () => {
  it.each([
    { deltaMs: 60, expectedSteps: 3, expectedQueueMs: 10 },
    { deltaMs: 30, expectedSteps: 1, expectedQueueMs: 30 - FIXED_STEP_MS },
    { deltaMs: 100, expectedSteps: 6, expectedQueueMs: 0 },
  ])('以 60Hz 固定步处理 $deltaMs ms 可见帧', ({ deltaMs, expectedSteps, expectedQueueMs }) => {
    const result = executePlan(createAccumulator(), {
      rawWallDeltaMs: deltaMs,
      paused: false,
      maxSteps: 6,
    })

    expect(result.acceptedWallDeltaMs).toBe(deltaMs)
    expect(result.discardedWallDeltaMs).toBe(0)
    expect(result.executedSteps).toBe(expectedSteps)
    expect(result.queuedMs).toBeCloseTo(expectedQueueMs, 10)
  })

  it('cap=4 保留未执行步骤，并可在后续零 delta 帧完全追赶', () => {
    const accumulator = createAccumulator()
    const burst = executePlan(accumulator, { rawWallDeltaMs: 100, paused: false, maxSteps: 4 })
    expect(burst).toMatchObject({ availableSteps: 6, maxExecutableSteps: 4, executedSteps: 4 })
    expect(burst.queuedWholeSteps).toBe(2)
    // 仍欠完整物理步时渲染 raw pose，不能 alpha=0 倒退到 previous。
    expect(burst.interpolationAlpha).toBe(1)

    const catchup = executePlan(accumulator, { rawWallDeltaMs: 0, paused: false, maxSteps: 4 })
    expect(catchup).toMatchObject({ availableSteps: 2, executedSteps: 2, queuedMs: 0 })
    expect(accumulator.snapshot()).toMatchObject({
      totalAcceptedWallDeltaMs: 100,
      totalExecutedSteps: 6,
    })
  })

  it('interpolationAlpha 无完整 backlog 时使用分数余量', () => {
    const result = executePlan(createAccumulator(), {
      rawWallDeltaMs: 30,
      paused: false,
      maxSteps: 1,
    })

    expect(result.queuedWholeSteps).toBe(0)
    expect(result.interpolationAlpha).toBeCloseTo(0.8, 12)
  })

  it('只扣真实完成的步骤，允许第 k 步结算后保留其余计划 backlog', () => {
    const accumulator = createAccumulator()
    const plan = accumulator.planFrame({ rawWallDeltaMs: 100, paused: false, maxSteps: 6 })
    expect(plan.maxExecutableSteps).toBe(6)
    accumulator.consumeStep()
    accumulator.consumeStep()

    const stoppedEarly = accumulator.finishFrame()
    expect(stoppedEarly).toMatchObject({ executedSteps: 2, queuedWholeSteps: 4 })
    expect(stoppedEarly.queuedMs).toBeCloseTo(4 * FIXED_STEP_MS, 10)

    const drained = executePlan(accumulator, { rawWallDeltaMs: 0, paused: false, maxSteps: 6 })
    expect(drained).toMatchObject({ executedSteps: 4, queuedMs: 0 })
  })

  it('持续 100ms/cap4 越过高水位后锁存 overload，不丢 backlog 也不继续执行', () => {
    const accumulator = createAccumulator(100)
    executePlan(accumulator, { rawWallDeltaMs: 100, paused: false, maxSteps: 4 })

    const overloaded = executePlan(accumulator, {
      rawWallDeltaMs: 100,
      paused: false,
      maxSteps: 4,
    })
    expect(overloaded.overload).toMatchObject({ active: true, enteredThisFrame: true })
    expect(overloaded).toMatchObject({
      acceptedWallDeltaMs: 100,
      maxExecutableSteps: 0,
      executedSteps: 0,
    })
    expect(overloaded.queuedMs).toBeCloseTo(100 + 2 * FIXED_STEP_MS, 10)

    const afterOverload = executePlan(accumulator, {
      rawWallDeltaMs: 20,
      paused: false,
      maxSteps: 6,
    })
    expect(afterOverload).toMatchObject({
      acceptedWallDeltaMs: 0,
      discardedWallDeltaMs: 20,
      discardedByOverloadMs: 20,
      maxExecutableSteps: 0,
    })
    expect(afterOverload.queuedMs).toBeCloseTo(overloaded.queuedMs, 10)
  })

  it('hidden 秒级 pause 全量归入 paused/discarded，不污染已有 backlog', () => {
    const accumulator = createAccumulator()
    executePlan(accumulator, { rawWallDeltaMs: 30, paused: false, maxSteps: 1 })
    const queueBeforePause = accumulator.snapshot().queuedMs

    const paused = executePlan(accumulator, { rawWallDeltaMs: 5000, paused: true, maxSteps: 6 })
    expect(paused).toMatchObject({
      rawWallDeltaMs: 5000,
      acceptedWallDeltaMs: 0,
      pausedWallDeltaMs: 5000,
      discardedWallDeltaMs: 5000,
      discardedByPauseMs: 5000,
      maxExecutableSteps: 0,
    })
    expect(paused.queuedMs).toBeCloseTo(queueBeforePause, 10)
    const snapshot = accumulator.snapshot()
    expect(snapshot.totalRawWallDeltaMs).toBe(
      snapshot.totalAcceptedWallDeltaMs + snapshot.totalDiscardedWallDeltaMs,
    )
  })

  it('visible delta 只接纳前 100ms，并显式记录 clamp 丢弃量', () => {
    const accumulator = createAccumulator()
    const result = executePlan(accumulator, { rawWallDeltaMs: 175, paused: false, maxSteps: 6 })
    expect(result).toMatchObject({
      rawWallDeltaMs: 175,
      acceptedWallDeltaMs: 100,
      discardedWallDeltaMs: 75,
      discardedByClampMs: 75,
      executedSteps: 6,
      queuedMs: 0,
    })
  })

  it('跨浮点边界累计出且只执行一个完整步', () => {
    const accumulator = createAccumulator()
    for (let index = 0; index < 9; index++) {
      const partial = executePlan(accumulator, {
        rawWallDeltaMs: FIXED_STEP_MS / 10,
        paused: false,
        maxSteps: 6,
      })
      expect(partial.executedSteps).toBe(0)
    }
    const boundary = executePlan(accumulator, {
      rawWallDeltaMs: FIXED_STEP_MS / 10,
      paused: false,
      maxSteps: 6,
    })
    expect(boundary).toMatchObject({ executedSteps: 1, queuedMs: 0 })
    expect(accumulator.snapshot().totalExecutedSimulationMs).toBeCloseTo(FIXED_STEP_MS, 12)
  })

  it('拒绝非法配置、帧输入和超额 consume', () => {
    expect(() => createFixedStepAccumulator({ fixedStepMs: 0, overloadHighWaterMs: 100 })).toThrow(
      RangeError,
    )
    expect(() =>
      createFixedStepAccumulator({ fixedStepMs: FIXED_STEP_MS, overloadHighWaterMs: Number.NaN }),
    ).toThrow(RangeError)
    const accumulator = createAccumulator()
    expect(() =>
      accumulator.planFrame({
        rawWallDeltaMs: Number.POSITIVE_INFINITY,
        paused: false,
        maxSteps: 4,
      }),
    ).toThrow(RangeError)
    expect(() => accumulator.planFrame({ rawWallDeltaMs: -1, paused: false, maxSteps: 4 })).toThrow(
      RangeError,
    )
    expect(() =>
      accumulator.planFrame({ rawWallDeltaMs: 1, paused: false, maxSteps: 1.5 }),
    ).toThrow(RangeError)

    accumulator.planFrame({ rawWallDeltaMs: 0, paused: false, maxSteps: 0 })
    expect(() => accumulator.consumeStep()).toThrow(RangeError)
    accumulator.finishFrame()
    expect(() => accumulator.consumeStep()).toThrow(Error)
  })
})
