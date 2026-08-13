import { PHYSICS } from './physics'

/** cadence/scheduler 定义字段或序列语义变化时必须递增。 */
export const PHYSICS_CADENCE_SCHEMA_VERSION = 1

export const PHYSICS_CADENCE_FIXED_STEP_MS = PHYSICS.fixedTimeStep * 1000
export const PHYSICS_CADENCE_MAX_ACCEPTED_WALL_DELTA_MS = 100
export const PHYSICS_CADENCE_OVERLOAD_HIGH_WATER_MS = 250
export const PHYSICS_CADENCE_DEFAULT_MAX_RENDER_FRAMES = 2_000

export type PhysicsCadenceId =
  | 'steady60'
  | 'steady30'
  | 'deterministic-jitter'
  | 'isolated100ms'
  | 'visibility-suspend'
  | 'sustained100ms'

export interface PhysicsCadenceFrame {
  rawWallDeltaMs: number
  paused: boolean
}

export interface PhysicsCadenceDefinition {
  id: PhysicsCadenceId
  version: typeof PHYSICS_CADENCE_SCHEMA_VERSION
  description: string
  /** 只运行一次的显式前缀，例如 burst 后的 0ms drain 或 visibility suspend/resume。 */
  prefix: readonly Readonly<PhysicsCadenceFrame>[]
  /** 前缀耗尽后循环；正常 cadence 不允许靠 driver 隐式补 0ms 帧。 */
  repeat: readonly Readonly<PhysicsCadenceFrame>[]
}

function frame(rawWallDeltaMs: number, paused = false): Readonly<PhysicsCadenceFrame> {
  return Object.freeze({ rawWallDeltaMs, paused })
}

function cadence(
  id: PhysicsCadenceId,
  description: string,
  prefix: readonly Readonly<PhysicsCadenceFrame>[],
  repeat: readonly Readonly<PhysicsCadenceFrame>[],
): Readonly<PhysicsCadenceDefinition> {
  if (repeat.length === 0) throw new RangeError(`cadence ${id} 必须有非空 repeat 序列`)
  return Object.freeze({
    id,
    version: PHYSICS_CADENCE_SCHEMA_VERSION,
    description,
    prefix: Object.freeze([...prefix]),
    repeat: Object.freeze([...repeat]),
  })
}

const STEP = PHYSICS_CADENCE_FIXED_STEP_MS

export const PHYSICS_CADENCES: Readonly<
  Record<PhysicsCadenceId, Readonly<PhysicsCadenceDefinition>>
> = Object.freeze({
  steady60: cadence('steady60', '稳定 60Hz，可见帧每帧接纳一个固定步', [], [frame(STEP)]),
  steady30: cadence('steady30', '稳定 30Hz，可见帧通常执行两个固定步', [], [frame(1000 / 30)]),
  'deterministic-jitter': cadence(
    'deterministic-jitter',
    '总计 100ms 的确定性抖动序列，循环平均保持 60Hz',
    [],
    [frame(8), frame(25), frame(12), frame(22), frame(16), frame(17)],
  ),
  isolated100ms: cadence(
    'isolated100ms',
    '一次 100ms burst，随后显式 0ms drain，再恢复 60Hz',
    [frame(100), frame(0)],
    [frame(STEP)],
  ),
  'visibility-suspend': cadence(
    'visibility-suspend',
    '100ms 后将 5s hidden 时间归入 pause，并用 0ms resume 帧排空既有 backlog',
    [frame(100), frame(5_000, true), frame(0)],
    [frame(STEP)],
  ),
  sustained100ms: cadence(
    'sustained100ms',
    '持续 100ms 慢帧，用于验证 cap4 backlog 高水位异常',
    [],
    [frame(100)],
  ),
})

export const PHYSICS_CADENCE_IDS = Object.freeze(
  Object.keys(PHYSICS_CADENCES) as PhysicsCadenceId[],
)

export function getPhysicsCadence(id: PhysicsCadenceId): Readonly<PhysicsCadenceDefinition> {
  return PHYSICS_CADENCES[id]
}

export function getPhysicsCadenceFrame(
  definition: Readonly<PhysicsCadenceDefinition>,
  frameIndex: number,
): Readonly<PhysicsCadenceFrame> {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
    throw new RangeError(`cadence frameIndex 必须是非负安全整数，收到 ${frameIndex}`)
  }
  if (frameIndex < definition.prefix.length) return definition.prefix[frameIndex]
  return definition.repeat[(frameIndex - definition.prefix.length) % definition.repeat.length]
}

export type PhysicsCadenceSchedulerId = 'reference-exact' | 'exact-cap6' | 'exact-cap4'

export interface PhysicsCadenceSchedulerDefinition {
  id: PhysicsCadenceSchedulerId
  version: typeof PHYSICS_CADENCE_SCHEMA_VERSION
  /** null 表示执行当前 accumulator 中所有可用整步。 */
  maxStepsPerFrame: number | null
}

export const PHYSICS_CADENCE_SCHEDULERS: Readonly<
  Record<PhysicsCadenceSchedulerId, Readonly<PhysicsCadenceSchedulerDefinition>>
> = Object.freeze({
  'reference-exact': Object.freeze({
    id: 'reference-exact',
    version: PHYSICS_CADENCE_SCHEMA_VERSION,
    maxStepsPerFrame: null,
  }),
  'exact-cap6': Object.freeze({
    id: 'exact-cap6',
    version: PHYSICS_CADENCE_SCHEMA_VERSION,
    maxStepsPerFrame: 6,
  }),
  'exact-cap4': Object.freeze({
    id: 'exact-cap4',
    version: PHYSICS_CADENCE_SCHEMA_VERSION,
    maxStepsPerFrame: 4,
  }),
})

export const PHYSICS_CADENCE_SCHEDULER_IDS = Object.freeze(
  Object.keys(PHYSICS_CADENCE_SCHEDULERS) as PhysicsCadenceSchedulerId[],
)

export function getPhysicsCadenceScheduler(
  id: PhysicsCadenceSchedulerId,
): Readonly<PhysicsCadenceSchedulerDefinition> {
  return PHYSICS_CADENCE_SCHEDULERS[id]
}
