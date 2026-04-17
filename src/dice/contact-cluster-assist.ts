import * as CANNON from 'cannon-es'
import { SETTLE } from '@/config/settle'

export interface ContactClusterAssistState {
  /** 某个接触簇第一次被连续观测到的时间 */
  firstSeenAtByClusterKey: Map<string, number>
  /** 当前轮次中已经介入过的接触簇，防止重复冻结 */
  assistedClusterKeys: Set<string>
}

export function createContactClusterAssistState(): ContactClusterAssistState {
  return {
    firstSeenAtByClusterKey: new Map(),
    assistedClusterKeys: new Set(),
  }
}

function isBelowThreshold(body: CANNON.Body, speedThreshold: number, angularThreshold: number): boolean {
  return body.velocity.length() < speedThreshold && body.angularVelocity.length() < angularThreshold
}

function getRelativeLinearSpeed(bodyA: CANNON.Body, bodyB: CANNON.Body): number {
  const dx = bodyA.velocity.x - bodyB.velocity.x
  const dy = bodyA.velocity.y - bodyB.velocity.y
  const dz = bodyA.velocity.z - bodyB.velocity.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function getClusterKey(cluster: CANNON.Body[]): string {
  return cluster
    .map((body) => body.id)
    .sort((a, b) => a - b)
    .join('-')
}

function pruneClusterTimers(state: ContactClusterAssistState, activeKeys: Set<string>): void {
  for (const key of state.firstSeenAtByClusterKey.keys()) {
    if (!activeKeys.has(key)) state.firstSeenAtByClusterKey.delete(key)
  }
}

function collectLowSpeedClusters(world: CANNON.World, activeBodies: CANNON.Body[]): CANNON.Body[][] {
  const assist = SETTLE.contactClusterAssist
  const activeSet = new Set(activeBodies)
  const adjacency = new Map<CANNON.Body, Set<CANNON.Body>>()
  for (const body of activeBodies) {
    adjacency.set(body, new Set())
  }

  const contacts = (world as CANNON.World & {
    contacts?: Array<{ bi: CANNON.Body; bj: CANNON.Body }>
  }).contacts ?? []

  for (const contact of contacts) {
    const bodyA = contact.bi
    const bodyB = contact.bj
    if (!activeSet.has(bodyA) || !activeSet.has(bodyB)) continue
    if (getRelativeLinearSpeed(bodyA, bodyB) > assist.relativeSpeedThreshold) continue
    adjacency.get(bodyA)?.add(bodyB)
    adjacency.get(bodyB)?.add(bodyA)
  }

  const visited = new Set<CANNON.Body>()
  const clusters: CANNON.Body[][] = []
  for (const body of activeBodies) {
    if (visited.has(body)) continue
    visited.add(body)
    const queue = [body]
    const cluster = [body]

    while (queue.length > 0) {
      const current = queue.shift()!
      for (const next of adjacency.get(current) ?? []) {
        if (visited.has(next)) continue
        visited.add(next)
        queue.push(next)
        cluster.push(next)
      }
    }

    if (cluster.length >= SETTLE.contactClusterAssist.minClusterSize) {
      clusters.push(cluster)
    }
  }

  return clusters
}

/**
 * 尾段接触簇 settle assist
 * 仅当“剩余活跃骰子”全部构成一个低速接触簇时才介入，避免影响正常滚动阶段。
 */
export function applyContactClusterSettleAssist(
  world: CANNON.World,
  bodies: CANNON.Body[],
  currentTime: number,
  state: ContactClusterAssistState,
  startTime: number,
): boolean {
  const assist = SETTLE.contactClusterAssist
  const activeKeys = new Set<string>()

  if (!assist.enabled || currentTime - startTime < assist.activationDelay) {
    pruneClusterTimers(state, activeKeys)
    return false
  }

  const candidateBodies = bodies.filter(
    (body) =>
      body.sleepState !== CANNON.Body.SLEEPING &&
      isBelowThreshold(body, assist.speedThreshold, assist.angularThreshold),
  )
  if (candidateBodies.length < assist.minClusterSize) {
    pruneClusterTimers(state, activeKeys)
    return false
  }

  const clusters = collectLowSpeedClusters(world, candidateBodies)
  for (const cluster of clusters) {
    if (cluster.length > assist.maxClusterSize) continue

    const clusterSet = new Set(cluster)
    const hasBusyOutsideBody = bodies.some(
      (body) =>
        !clusterSet.has(body) &&
        body.sleepState !== CANNON.Body.SLEEPING &&
        !isBelowThreshold(body, SETTLE.speedThreshold, SETTLE.angularThreshold),
    )
    if (hasBusyOutsideBody) continue

    const clusterKey = getClusterKey(cluster)
    activeKeys.add(clusterKey)
    if (state.assistedClusterKeys.has(clusterKey)) continue

    const firstSeenAt = state.firstSeenAtByClusterKey.get(clusterKey)
    if (firstSeenAt === undefined) {
      state.firstSeenAtByClusterKey.set(clusterKey, currentTime)
      continue
    }

    if (currentTime - firstSeenAt < assist.persistenceDuration) continue

    // 确认是持续性低速咬合后，直接冻结该局部接触簇，避免尾段轻碰撞反复打断 stable window。
    for (const body of cluster) {
      body.velocity.set(0, 0, 0)
      body.angularVelocity.set(0, 0, 0)
      body.sleep()
    }
    state.assistedClusterKeys.add(clusterKey)
    pruneClusterTimers(state, activeKeys)
    return true
  }

  pruneClusterTimers(state, activeKeys)
  return false
}