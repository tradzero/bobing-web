import type * as CANNON from 'cannon-es'

/** 初始刚体状态的字段、顺序或字节编码变化时必须递增。 */
export const THROW_INITIAL_STATE_VERSION = 1

const FLOAT_ENCODING = 'ieee754-float64-be' as const
const HASH_ALGORITHM = 'fnv1a64' as const
const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV64_PRIME = 0x100000001b3n
const FNV64_MASK = 0xffffffffffffffffn

export interface ThrowInitialBodyState {
  position: readonly [number, number, number]
  quaternion: readonly [number, number, number, number]
  velocity: readonly [number, number, number]
  angularVelocity: readonly [number, number, number]
}

export interface ThrowInitialStateDiagnostics {
  version: typeof THROW_INITIAL_STATE_VERSION
  floatEncoding: typeof FLOAT_ENCODING
  hashAlgorithm: typeof HASH_ALGORITHM
  hash: string
  bodies: readonly ThrowInitialBodyState[]
}

function vector3(value: CANNON.Vec3): [number, number, number] {
  return [value.x, value.y, value.z]
}

function quaternion(value: CANNON.Quaternion): [number, number, number, number] {
  return [value.x, value.y, value.z, value.w]
}

function updateFnv64(hash: bigint, bytes: Uint8Array): bigint {
  let next = hash
  for (const byte of bytes) {
    next ^= BigInt(byte)
    next = (next * FNV64_PRIME) & FNV64_MASK
  }
  return next
}

function hashInitialBodies(bodies: readonly ThrowInitialBodyState[]): string {
  let hash = FNV64_OFFSET_BASIS
  const header = new ArrayBuffer(8)
  const headerView = new DataView(header)
  headerView.setUint32(0, THROW_INITIAL_STATE_VERSION, false)
  headerView.setUint32(4, bodies.length, false)
  hash = updateFnv64(hash, new Uint8Array(header))

  const float = new ArrayBuffer(8)
  const floatView = new DataView(float)
  for (const body of bodies) {
    const values = [...body.position, ...body.quaternion, ...body.velocity, ...body.angularVelocity]
    for (const value of values) {
      // 显式大端 Float64 编码，避免 JSON/toFixed 精度和平台文本格式差异。
      floatView.setFloat64(0, value, false)
      hash = updateFnv64(hash, new Uint8Array(float))
    }
  }

  return hash.toString(16).padStart(16, '0')
}

/**
 * throwDice() 返回后立即只读捕获；输入顺序就是 A/B 的 canonical dice body 顺序。
 * 此函数不唤醒 body、不写物理字段，也不消费随机数。
 */
export function captureThrowInitialState(
  bodies: readonly CANNON.Body[],
): ThrowInitialStateDiagnostics {
  const snapshots = bodies.map(
    (body): ThrowInitialBodyState => ({
      position: vector3(body.position),
      quaternion: quaternion(body.quaternion),
      velocity: vector3(body.velocity),
      angularVelocity: vector3(body.angularVelocity),
    }),
  )

  return {
    version: THROW_INITIAL_STATE_VERSION,
    floatEncoding: FLOAT_ENCODING,
    hashAlgorithm: HASH_ALGORITHM,
    hash: hashInitialBodies(snapshots),
    bodies: snapshots,
  }
}

/** controller 对外返回防御副本，避免诊断消费者改写下一份 post-render 快照。 */
export function cloneThrowInitialState(
  state: ThrowInitialStateDiagnostics,
): ThrowInitialStateDiagnostics {
  return {
    ...state,
    bodies: state.bodies.map((body) => ({
      position: [...body.position],
      quaternion: [...body.quaternion],
      velocity: [...body.velocity],
      angularVelocity: [...body.angularVelocity],
    })),
  }
}
