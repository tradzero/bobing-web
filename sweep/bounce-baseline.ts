/**
 * 碗底弹跳回归基线
 *
 * 两条固定回归场景 × 两种碰撞体（chamfer / box 对照）：
 * 1. idle 初始化场景 — 骰子从 Y=0.3 自由落入碗底
 * 2. seed 1776390018022 投掷场景 — 已知弹跳问题种子
 *
 * 输出统一指标，用于后续 restitution sweep / HF 分辨率 / chamferRatio sweep 的对照
 */
import * as CANNON from 'cannon-es'
import { createPhysicsWorld } from '@/physics/world'
import { createBowlBodies } from '@/physics/bowl-body'
import { setupContactMaterials } from '@/physics/materials'
import { createDiceBody, type ShapeMode } from '@/dice/dice-body'
import { PHYSICS } from '@/config/physics'
import { reseed } from '@/utils/random'
import { DEFAULT_SWEEP_CHAMFER_RATIO, runTrial } from './lib/run-trial'

// ─── 指标类型 ───────────────────────────────────────────

interface IdleMetrics {
  /** 每颗骰子最大二次抬升高度 (m)，首次触底后的最大回升 */
  maxSecondaryLift: number
  /** 哪颗骰子是主问题体 (0-indexed) */
  worstDieIndex: number
  /** 首次全部 sleep 帧号 (-1 = 未 sleep) */
  allSleepFrame: number
  /** 首次全部 sleep 时间 (s) */
  allSleepTime: number
  /** sleep 前是否出现可见二次弹跳 (抬升 > 5mm) */
  visibleBounceBeforeSleep: boolean
  /** 每颗骰子 Y 范围 */
  perDieYRange: { min: number; max: number; delta: number }[]
}

interface ThrowMetrics {
  /** frame 100 后主问题骰子最大 Y 回升 (m) */
  maxYRiseAfter100: number
  /** 主问题骰子 index */
  worstDieIndex: number
  /** stable window 被打破次数 */
  stableBrokenCount: number
  /** 首次全部 sleep 帧号 */
  allSleepFrame: number
  /** 首次全部 sleep 时间 (s) */
  allSleepTime: number
  /** 投掷阶段最大反弹高度 (m，所有骰子) */
  maxBounceHeight: number
  /** 投掷阶段滚动总时长 (s，从投掷到 settle) */
  totalRollDuration: number
  /** settle 路径 */
  settlePath: 'sleep' | 'threshold' | 'timeout'
  /** 每颗骰子 frame100+ Y 范围 */
  perDieYRange: { min: number; max: number; delta: number }[]
}

// ─── 场景 1: idle 初始化 ──────────────────────────────────

function runIdleScene(shapeMode: ShapeMode): IdleMetrics {
  reseed(42) // 固定种子，idle 不依赖投掷随机
  const { world, step, dispose } = createPhysicsWorld()
  setupContactMaterials(world)
  createBowlBodies(world)

  const bodies: CANNON.Body[] = []
  for (let i = 0; i < 6; i++) {
    const body = createDiceBody(
      shapeMode === 'chamfer'
        ? { shapeMode, chamferRatio: DEFAULT_SWEEP_CHAMFER_RATIO }
        : { shapeMode },
    )
    // 模拟 GameViewport idle 初始化：圆形排列，Y=0.3
    const angle = (i / 6) * Math.PI * 2
    body.position.set(Math.cos(angle) * 0.3, 0.3, Math.sin(angle) * 0.3)
    body.previousPosition.copy(body.position)
    body.aabbNeedsUpdate = true
    world.addBody(body)
    bodies.push(body)
  }

  const dt = PHYSICS.fixedTimeStep
  const maxFrames = 600 // 10s 足够 idle 收敛

  // 追踪每颗骰子：首个反弹窗口的最低点和最高点
  const minY = new Array(6).fill(Infinity)
  const maxY = new Array(6).fill(-Infinity)
  const reboundBaseY = new Array(6).fill(Infinity)
  const reboundPeakY = new Array(6).fill(-Infinity)
  const reboundStarted = new Array(6).fill(false)
  const reboundCompleted = new Array(6).fill(false)
  const prevVelY = new Array(6).fill(0)

  let allSleepFrame = -1
  let allSleepTime = -1

  for (let f = 0; f < maxFrames; f++) {
    step(dt)
    const t = (f + 1) * dt

    for (let i = 0; i < 6; i++) {
      const y = bodies[i].position.y
      const vy = bodies[i].velocity.y
      if (y < minY[i]) minY[i] = y
      if (y > maxY[i]) maxY[i] = y

      // 以“下降转上升”捕获首个反弹窗口，避免把滑落过程误记为二次抬升
      if (!reboundStarted[i] && prevVelY[i] < -0.01 && vy >= 0 && y < 0.25) {
        reboundStarted[i] = true
        reboundBaseY[i] = y
        reboundPeakY[i] = y
      }

      if (reboundStarted[i] && !reboundCompleted[i]) {
        if (y > reboundPeakY[i]) reboundPeakY[i] = y
        if (prevVelY[i] > 0.01 && vy <= 0) reboundCompleted[i] = true
      }

      prevVelY[i] = vy
    }

    // 全部 sleep 检测
    if (allSleepFrame < 0 && bodies.every(b => b.sleepState === CANNON.Body.SLEEPING)) {
      allSleepFrame = f
      allSleepTime = t
    }

    // 全部 sleep 后 60 帧退出
    if (allSleepFrame >= 0 && f > allSleepFrame + 60) break
  }

  const secondaryLifts = bodies.map((_, i) => {
    if (!reboundStarted[i]) return 0
    return Math.max(0, reboundPeakY[i] - reboundBaseY[i])
  })
  const worstIdx = secondaryLifts.indexOf(Math.max(...secondaryLifts))

  const perDieYRange = bodies.map((_, i) => ({
    min: minY[i],
    max: maxY[i],
    delta: maxY[i] - minY[i],
  }))

  dispose()

  return {
    maxSecondaryLift: secondaryLifts[worstIdx],
    worstDieIndex: worstIdx,
    allSleepFrame,
    allSleepTime,
    visibleBounceBeforeSleep: secondaryLifts.some(l => l > 0.005),
    perDieYRange,
  }
}

// ─── 场景 2: seed 1776390018022 投掷 ─────────────────────

function runThrowScene(shapeMode: ShapeMode): ThrowMetrics {
  const SEED = 1776390018022
  const post100MinY = new Array(6).fill(Infinity)
  const post100MaxY = new Array(6).fill(-Infinity)
  let maxBounceHeight = -Infinity
  const trial = runTrial({
    seed: SEED,
    maxFrames: 1200,
    shapeMode,
    onFrame(frame, _time, bodies) {
      for (const body of bodies) {
        if (body.position.y > maxBounceHeight) maxBounceHeight = body.position.y
      }
      if (frame < 100) return
      for (let i = 0; i < 6; i++) {
        const y = bodies[i].position.y
        if (y < post100MinY[i]) post100MinY[i] = y
        if (y > post100MaxY[i]) post100MaxY[i] = y
      }
    },
  })

  const yRiseAfter100 = post100MaxY.map((max, i) => max - post100MinY[i])
  const worstIdx = yRiseAfter100.indexOf(Math.max(...yRiseAfter100))

  const perDieYRange = post100MinY.map((min, i) => ({
    min,
    max: post100MaxY[i],
    delta: yRiseAfter100[i],
  }))

  return {
    maxYRiseAfter100: yRiseAfter100[worstIdx],
    worstDieIndex: worstIdx,
    stableBrokenCount: trial.stableBrokenCount,
    allSleepFrame: trial.allSleepFrame,
    allSleepTime: trial.allSleepTime,
    maxBounceHeight,
    totalRollDuration: trial.settleTime,
    settlePath: trial.settlePath,
    perDieYRange,
  }
}

// ─── 输出 ──────────────────────────────────────────────

function printIdleMetrics(label: string, m: IdleMetrics) {
  console.log(`\n═══ ${label} — Idle 初始化场景 ═══`)
  console.log(`  主问题骰子: die${m.worstDieIndex + 1}`)
  console.log(`  最大二次抬升: ${(m.maxSecondaryLift * 1000).toFixed(1)}mm`)
  console.log(`  可见弹跳(>5mm): ${m.visibleBounceBeforeSleep ? '⚠️ YES' : '✓ NO'}`)
  console.log(`  全部 sleep 帧: ${m.allSleepFrame} (${m.allSleepTime >= 0 ? m.allSleepTime.toFixed(2) + 's' : 'N/A'})`)
  console.log(`  每颗骰子 Y 范围:`)
  m.perDieYRange.forEach((r, i) => {
    const tag = r.delta > 0.01 ? '⚠️' : '✓'
    console.log(`    die${i + 1}: [${r.min.toFixed(4)}, ${r.max.toFixed(4)}] delta=${(r.delta * 1000).toFixed(1)}mm ${tag}`)
  })
}

function printThrowMetrics(label: string, m: ThrowMetrics) {
  console.log(`\n═══ ${label} — Throw 场景 (seed=1776390018022) ═══`)
  console.log(`  主问题骰子: die${m.worstDieIndex + 1}`)
  console.log(`  frame100+ 最大 Y 回升: ${(m.maxYRiseAfter100 * 1000).toFixed(1)}mm`)
  console.log(`  stable 打破次数: ${m.stableBrokenCount}`)
  console.log(`  全部 sleep 帧: ${m.allSleepFrame} (${m.allSleepTime >= 0 ? m.allSleepTime.toFixed(2) + 's' : 'N/A'})`)
  console.log(`  最大反弹高度: ${m.maxBounceHeight.toFixed(3)}m`)
  console.log(`  滚动总时长: ${m.totalRollDuration.toFixed(2)}s`)
  console.log(`  settle 路径: ${m.settlePath}`)
  console.log(`  每颗骰子 frame100+ Y 范围:`)
  m.perDieYRange.forEach((r, i) => {
    const tag = r.delta > 0.01 ? '⚠️' : '✓'
    console.log(`    die${i + 1}: [${r.min.toFixed(4)}, ${r.max.toFixed(4)}] delta=${(r.delta * 1000).toFixed(1)}mm ${tag}`)
  })
}

// ─── Main ──────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════╗')
console.log('║       碗底弹跳回归基线（chamfer + box 对照）       ║')
console.log('╚══════════════════════════════════════════════════╝')
console.log()
console.log(`配置: chamferRatio=${PHYSICS.diceChamferRatio}, damping=${PHYSICS.diceLinearDamping}/${PHYSICS.diceAngularDamping}`)
console.log(`      sleepSpeed=${PHYSICS.diceSleepSpeedLimit}, sleepTime=${PHYSICS.diceSleepTimeLimit}`)
console.log(`      diceFloor: friction=${PHYSICS.contact.diceFloor.friction}, restitution=${PHYSICS.contact.diceFloor.restitution}`)
console.log(`      diceWall: friction=${PHYSICS.contact.diceWall.friction}, restitution=${PHYSICS.contact.diceWall.restitution}`)
console.log(`      HF_GRID_SIZE=51, elementSize=0.052m`)

const shapeModes: ShapeMode[] = ['chamfer', 'box']

for (const mode of shapeModes) {
  const label = mode === 'chamfer' ? 'CHAMFER (当前)' : 'BOX (对照)'

  const idleMetrics = runIdleScene(mode)
  printIdleMetrics(label, idleMetrics)

  const throwMetrics = runThrowScene(mode)
  printThrowMetrics(label, throwMetrics)
}

console.log('\n══════════════════════════════════════════════════')
console.log('基线记录完毕。后续 sweep 实验应与此对照。')
