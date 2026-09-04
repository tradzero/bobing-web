// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import * as CANNON from 'cannon-es'
import { PHYSICS } from '@dice/physics-core/config/physics'
import { ESCAPE_Y, createBowlBodies } from '@dice/physics-core/physics/bowl-body'
import { createRollStepSession } from '@dice/physics-core/physics/roll-step-session'
import { createPhysicsWorld } from '@dice/physics-core/physics/world'

function createFixture() {
  const physics = createPhysicsWorld()
  const bowlBottom = createBowlBodies(physics.world).bottom
  const body = new CANNON.Body({ mass: 0.03, allowSleep: true })
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.12, 0.12, 0.12)))
  physics.world.addBody(body)
  return { ...physics, body, bowlBottom }
}

describe('roll exact-step session', () => {
  it('按 exact step、原始安全采样、escape guard、settle 的顺序执行', () => {
    const { world, body, bowlBottom, stepExact: physicsStepExact, dispose } = createFixture()
    const stepExact = vi.fn(() => {
      physicsStepExact()
      body.position.set(0, ESCAPE_Y + 0.01, 0)
      body.velocity.set(0, 10, 0)
    })
    const session = createRollStepSession({
      world,
      bodies: [body],
      stepExact,
      settlementPolicy: 'runtime',
      contactClusterAssistEnabled: false,
      poseStableWindowEnabled: false,
      floorRelaunchTracking: { bowlBottom },
    })

    try {
      const step = session.advanceExactStep()
      const diagnostics = session.finish()

      expect(stepExact).toHaveBeenCalledOnce()
      expect(step).toEqual({
        simulationStep: 1,
        simulationTime: PHYSICS.fixedTimeStep,
        settled: null,
      })
      // maxSpeed 在 guard 前采样，body velocity 则已被 guard 反射。
      expect(diagnostics.maxSpeed).toBe(10)
      expect(diagnostics.escapeGuardInterventionCount).toBe(1)
      expect(body.velocity.y).toBe(-3)
      expect(diagnostics.floorRelaunch.available).toBe(true)
    } finally {
      dispose()
    }
  })

  it('使用整数步数生成模拟时间，并在停稳后拒绝额外推进', () => {
    const { world, body, bowlBottom, stepExact, dispose } = createFixture()
    body.sleep()
    const session = createRollStepSession({
      world,
      bodies: [body],
      stepExact,
      settlementPolicy: 'runtime',
      contactClusterAssistEnabled: false,
      poseStableWindowEnabled: false,
      floorRelaunchTracking: { bowlBottom },
    })

    try {
      const step = session.advanceExactStep()

      expect(step).toEqual({
        simulationStep: 1,
        simulationTime: PHYSICS.fixedTimeStep,
        settled: { reason: 'natural-sleep', elapsed: PHYSICS.fixedTimeStep },
      })
      expect(() => session.advanceExactStep()).toThrow(/已停稳/)
      expect(session.snapshot()).toMatchObject({
        simulationStep: 1,
        simulationTime: PHYSICS.fixedTimeStep,
      })
      expect(session.finish()).toEqual(session.finish())
      expect(() => session.advanceExactStep()).toThrow(/已结束/)
    } finally {
      dispose()
    }
  })

  it('逐步累计 sleep wake 与低速姿态窗口诊断', () => {
    const { world, body, bowlBottom, stepExact: physicsStepExact, dispose } = createFixture()
    body.sleep()
    let stepCount = 0
    const session = createRollStepSession({
      world,
      bodies: [body],
      stepExact: () => {
        physicsStepExact()
        stepCount++
        if (stepCount === 1) body.wakeUp()
        body.position.set(stepCount * 0.001, 0, 0)
        body.quaternion.set(0, 0, 0, 1)
        body.velocity.setZero()
        body.angularVelocity.setZero()
      },
      settlementPolicy: 'runtime',
      contactClusterAssistEnabled: false,
      poseStableWindowEnabled: false,
      floorRelaunchTracking: { bowlBottom },
      stableWindowDiagnosticsEnabled: true,
    })

    try {
      expect(session.advanceExactStep().settled).toBeNull()
      expect(session.advanceExactStep().settled).toBeNull()
      const diagnostics = session.finish()

      expect(diagnostics.sleepWakeCount).toBe(1)
      expect(diagnostics.longestStableWindow).toBeCloseTo(PHYSICS.fixedTimeStep, 12)
      expect(diagnostics.maxStableWindowPositionDrift).toBeCloseTo(0.001, 12)
      expect(diagnostics.maxStableWindowAngularDrift).toBe(0)
      expect(diagnostics.faceChangedDuringStableWindow).toBe(false)
    } finally {
      dispose()
    }
  })

  it('拒绝没有恰好推进一个 Cannon 步的 stepExact 实现', () => {
    const { world, body, dispose } = createFixture()
    const phases: string[] = []
    const externalBodies = [body]
    const session = createRollStepSession({
      world,
      bodies: externalBodies,
      stepExact: () => undefined,
      settlementPolicy: 'runtime',
      runPhase: (phase, action) => {
        phases.push(phase)
        action()
      },
    })
    externalBodies.length = 0

    try {
      expect(() => session.advanceExactStep()).toThrow(/step contract/)
      expect(phases).toEqual(['world-step'])
      expect(session.snapshot()).toMatchObject({ simulationStep: 0, simulationTime: 0 })
    } finally {
      dispose()
    }
  })

  it('拒绝伪装成单步但残留 Cannon 墙钟债务的 batched step', () => {
    const { world, body, dispose } = createFixture()
    const session = createRollStepSession({
      world,
      bodies: [body],
      stepExact: () => world.step(PHYSICS.fixedTimeStep, 0.02, 1),
      settlementPolicy: 'runtime',
    })

    try {
      expect(() => session.advanceExactStep()).toThrow(/exact step contract/)
      // Cannon 的确执行了一个 internalStep；session 仍不能把错误调用计入自身时间。
      expect(world.stepnumber).toBe(1)
      expect(world.time).toBeCloseTo(0.02, 12)
      expect(world.accumulator).toBeCloseTo(0.02 - PHYSICS.fixedTimeStep, 12)
      expect(session.snapshot()).toMatchObject({ simulationStep: 0, simulationTime: 0 })
    } finally {
      dispose()
    }
  })

  it('创建时拒绝继承 Cannon batched accumulator 债务', () => {
    const { world, body, dispose } = createFixture()
    world.accumulator = PHYSICS.fixedTimeStep / 10

    try {
      expect(() =>
        createRollStepSession({
          world,
          bodies: [body],
          stepExact: () => world.step(PHYSICS.fixedTimeStep),
          settlementPolicy: 'runtime',
        }),
      ).toThrow(/session 创建时.*accumulator/)
    } finally {
      dispose()
    }
  })

  it('普通模式不创建 floor/stable 扩展采样，但仍发布累计安全快照', () => {
    const { world, body, stepExact, dispose } = createFixture()
    body.velocity.set(1, 0, 0)
    const phases: string[] = []
    const session = createRollStepSession({
      world,
      bodies: [body],
      stepExact,
      settlementPolicy: 'runtime',
      poseStableWindowEnabled: false,
      runPhase: (phase, action) => {
        phases.push(phase)
        action()
      },
    })

    try {
      session.advanceExactStep()
      expect(phases).toEqual(['world-step', 'roll-safety', 'escape-guard', 'settle'])
      expect(session.snapshot().simulationStep).toBe(1)
      expect(session.snapshot().maxSpeed).toBeGreaterThanOrEqual(1)
      expect(session.finish().floorRelaunch).toMatchObject({
        available: false,
        unavailableReason: 'floor relaunch tracking disabled',
      })
    } finally {
      dispose()
    }
  })
})
