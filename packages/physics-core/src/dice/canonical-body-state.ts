import type * as CANNON from 'cannon-es'

/** canonical body state 的字段、顺序或字节编码变化时必须递增。 */
export const CANONICAL_BODY_STATE_VERSION = 1

export const CANONICAL_BODY_STATE_FLOAT_ENCODING = 'ieee754-float64-be' as const
export const CANONICAL_BODY_STATE_HASH_ALGORITHM = 'fnv1a64' as const

const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV64_PRIME = 0x100000001b3n
const FNV64_MASK = 0xffffffffffffffffn

export interface CanonicalBodyState {
  position: readonly [number, number, number]
  quaternion: readonly [number, number, number, number]
  velocity: readonly [number, number, number]
  angularVelocity: readonly [number, number, number]
}

export interface CanonicalBodyStateDiagnostics {
  version: typeof CANONICAL_BODY_STATE_VERSION
  floatEncoding: typeof CANONICAL_BODY_STATE_FLOAT_ENCODING
  hashAlgorithm: typeof CANONICAL_BODY_STATE_HASH_ALGORITHM
  hash: string
  /** 输入 body 顺序就是签名与 A/B 比较使用的 canonical 顺序。 */
  bodies: readonly CanonicalBodyState[]
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

function hashCanonicalBodies(bodies: readonly CanonicalBodyState[]): string {
  let hash = FNV64_OFFSET_BASIS
  const header = new ArrayBuffer(8)
  const headerView = new DataView(header)
  headerView.setUint32(0, CANONICAL_BODY_STATE_VERSION, false)
  headerView.setUint32(4, bodies.length, false)
  hash = updateFnv64(hash, new Uint8Array(header))

  const float = new ArrayBuffer(8)
  const floatView = new DataView(float)
  for (const body of bodies) {
    const values = [...body.position, ...body.quaternion, ...body.velocity, ...body.angularVelocity]
    for (const value of values) {
      // 显式大端 Float64 编码；保留 -0、次正规数等 JSON 文本无法表达的位级差异。
      floatView.setFloat64(0, value, false)
      hash = updateFnv64(hash, new Uint8Array(float))
    }
  }

  return hash.toString(16).padStart(16, '0')
}

/**
 * 只读捕获 Cannon body 真值，不唤醒、不归一化 quaternion，也不截断任何动力学字段。
 */
export function captureCanonicalBodyState(
  bodies: readonly CANNON.Body[],
): CanonicalBodyStateDiagnostics {
  const snapshots = bodies.map(
    (body): CanonicalBodyState => ({
      position: vector3(body.position),
      quaternion: quaternion(body.quaternion),
      velocity: vector3(body.velocity),
      angularVelocity: vector3(body.angularVelocity),
    }),
  )

  return {
    version: CANONICAL_BODY_STATE_VERSION,
    floatEncoding: CANONICAL_BODY_STATE_FLOAT_ENCODING,
    hashAlgorithm: CANONICAL_BODY_STATE_HASH_ALGORITHM,
    hash: hashCanonicalBodies(snapshots),
    bodies: snapshots,
  }
}

/** 对外发布时创建完整防御副本，tuple 不与内部 canonical snapshot 共享。 */
export function cloneCanonicalBodyState(
  state: CanonicalBodyStateDiagnostics,
): CanonicalBodyStateDiagnostics {
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
