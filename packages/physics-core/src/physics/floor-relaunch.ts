import * as CANNON from 'cannon-es'

export const FLOOR_RELAUNCH_TRACKER_VERSION = 1
export const FLOOR_RELAUNCH_INITIAL_CONTACT_STEPS = 2
export const FLOOR_RELAUNCH_SUPPORT_STEPS = 6
export const FLOOR_RELAUNCH_MIN_AIRBORNE_STEPS = 2
/** 吸收 sleeping broadphase 不再保留静态 contact 及 Heightfield 数值误差；远低于 5mm 事件阈值。 */
export const FLOOR_RELAUNCH_SUPPORT_CLEARANCE_TOLERANCE = 0.0005
export const FLOOR_RELAUNCH_CLEARANCE_THRESHOLD = 0.005
export const FLOOR_RELAUNCH_WORLD_Y_RISE_THRESHOLD = 0.005
const FLOOR_RELAUNCH_THRESHOLD_EPSILON = 1e-9

export interface FloorRelaunchFrameSample {
  floorContact: boolean
  /** 骰子、墙或桌面接触都会使该离地 episode 失去 floor-only 归因。 */
  externalContact: boolean
  floorClearance: number
  worldY: number
}

export interface FloorRelaunchEvent {
  dieIndex: number
  airborneSteps: number
  peakClearance: number
  orderedWorldYRise: number
  externalContactObserved: boolean
  preExternalPeakClearance: number
  preExternalOrderedWorldYRise: number
  qualifiesAsRelaunch: boolean
}

export interface FloorRelaunchDiagnostics {
  version: typeof FLOOR_RELAUNCH_TRACKER_VERSION
  available: boolean
  unavailableReason: string | null
  initialContactObservedDiceCount: number
  armedDiceCount: number
  secondaryEpisodeCount: number
  floorOnlySecondaryEpisodeCount: number
  relaunchEventCount: number
  maxFloorOnlySecondaryClearance: number
  maxFloorOnlySecondaryOrderedWorldYRise: number
  maxPreExternalSecondaryClearance: number
  maxPreExternalSecondaryOrderedWorldYRise: number
  /** 仅保留为旧脚本误报对照；它没有事件顺序或接触归因，绝不能单独作为门禁。 */
  legacyUnorderedPost100WorldYRange: number
  events: FloorRelaunchEvent[]
}

interface ActiveEpisode {
  airborneSteps: number
  peakClearance: number
  minimumWorldY: number
  orderedWorldYRise: number
  externalContactObserved: boolean
  qualifiedBeforeExternalContact: boolean
  preExternalPeakClearance: number
  preExternalOrderedWorldYRise: number
}

interface DieState {
  initialFloorContactStreak: number
  initialFloorContactEstablished: boolean
  initialReboundPhase: 'awaiting-takeoff' | 'airborne' | 'complete'
  cleanSupportStreak: number
  secondaryReady: boolean
  activeEpisode: ActiveEpisode | null
  lastSupportedWorldY: number
  legacyMinY: number
  legacyMaxY: number
}

export interface FloorRelaunchTracker {
  sample: (samples: readonly FloorRelaunchFrameSample[]) => void
  finish: () => FloorRelaunchDiagnostics
}

function exceedsThreshold(value: number, threshold: number): boolean {
  return value - threshold > FLOOR_RELAUNCH_THRESHOLD_EPSILON
}

function createDieState(): DieState {
  return {
    initialFloorContactStreak: 0,
    initialFloorContactEstablished: false,
    initialReboundPhase: 'awaiting-takeoff',
    cleanSupportStreak: 0,
    secondaryReady: false,
    activeEpisode: null,
    lastSupportedWorldY: Number.NaN,
    legacyMinY: Infinity,
    legacyMaxY: -Infinity,
  }
}

/**
 * 事件级二次离地 tracker。
 *
 * 正常首次落碗反弹不会计为 secondary；只有至少 6 个连续、无其他接触的碗底支撑步后，
 * 再出现的离地 episode 才进入候选。世界 Y 抬升必须发生在 episode 的最低点之后，避免
 * 旧 `maxY-minY` 把“先高后低”的沿坡下降误叫成反弹。
 */
export function createFloorRelaunchTracker(diceCount: number): FloorRelaunchTracker {
  const states = Array.from({ length: diceCount }, createDieState)
  const events: FloorRelaunchEvent[] = []
  let sampledFrames = 0

  const finalizeEpisode = (dieIndex: number, state: DieState): void => {
    const episode = state.activeEpisode
    if (!episode) return

    const qualifiesAsRelaunch = episode.qualifiedBeforeExternalContact
    events.push({
      dieIndex,
      airborneSteps: episode.airborneSteps,
      peakClearance: episode.peakClearance,
      orderedWorldYRise: episode.orderedWorldYRise,
      externalContactObserved: episode.externalContactObserved,
      preExternalPeakClearance: episode.preExternalPeakClearance,
      preExternalOrderedWorldYRise: episode.preExternalOrderedWorldYRise,
      qualifiesAsRelaunch,
    })
    state.activeEpisode = null
  }

  const updateEpisode = (episode: ActiveEpisode, sample: FloorRelaunchFrameSample): void => {
    const cleanThroughSample = !episode.externalContactObserved && !sample.externalContact
    episode.airborneSteps++
    episode.peakClearance = Math.max(episode.peakClearance, sample.floorClearance)
    episode.orderedWorldYRise = Math.max(
      episode.orderedWorldYRise,
      sample.worldY - episode.minimumWorldY,
    )
    episode.minimumWorldY = Math.min(episode.minimumWorldY, sample.worldY)
    if (
      cleanThroughSample &&
      episode.airborneSteps >= FLOOR_RELAUNCH_MIN_AIRBORNE_STEPS &&
      exceedsThreshold(episode.peakClearance, FLOOR_RELAUNCH_CLEARANCE_THRESHOLD) &&
      exceedsThreshold(episode.orderedWorldYRise, FLOOR_RELAUNCH_WORLD_Y_RISE_THRESHOLD)
    ) {
      episode.qualifiedBeforeExternalContact = true
    }
    if (cleanThroughSample) {
      episode.preExternalPeakClearance = episode.peakClearance
      episode.preExternalOrderedWorldYRise = episode.orderedWorldYRise
    }
    episode.externalContactObserved ||= sample.externalContact
  }

  return {
    sample(samples) {
      if (samples.length !== states.length) {
        throw new RangeError(
          `floor relaunch tracker 期望 ${states.length} 颗骰子，收到 ${samples.length}`,
        )
      }
      sampledFrames++

      samples.forEach((sample, dieIndex) => {
        const state = states[dieIndex]
        const floorSupported =
          sample.floorContact || sample.floorClearance <= FLOOR_RELAUNCH_SUPPORT_CLEARANCE_TOLERANCE
        if (floorSupported) state.lastSupportedWorldY = sample.worldY
        if (sampledFrames > 100) {
          state.legacyMinY = Math.min(state.legacyMinY, sample.worldY)
          state.legacyMaxY = Math.max(state.legacyMaxY, sample.worldY)
        }

        if (state.activeEpisode) {
          state.activeEpisode.externalContactObserved ||= sample.externalContact
          if (floorSupported) {
            finalizeEpisode(dieIndex, state)
            state.cleanSupportStreak = sample.externalContact ? 0 : 1
          } else {
            updateEpisode(state.activeEpisode, sample)
          }
          return
        }

        if (!state.initialFloorContactEstablished) {
          state.initialFloorContactStreak =
            sample.floorContact && !sample.externalContact ? state.initialFloorContactStreak + 1 : 0
          if (state.initialFloorContactStreak >= FLOOR_RELAUNCH_INITIAL_CONTACT_STEPS) {
            state.initialFloorContactEstablished = true
            state.cleanSupportStreak = state.initialFloorContactStreak
          }
          return
        }

        if (state.initialReboundPhase === 'awaiting-takeoff') {
          if (!floorSupported) {
            state.initialReboundPhase = 'airborne'
            state.cleanSupportStreak = 0
          } else {
            state.cleanSupportStreak = sample.externalContact ? 0 : state.cleanSupportStreak + 1
            if (state.cleanSupportStreak >= FLOOR_RELAUNCH_SUPPORT_STEPS) {
              state.initialReboundPhase = 'complete'
              state.secondaryReady = true
            }
          }
          return
        }

        if (state.initialReboundPhase === 'airborne') {
          if (floorSupported) {
            state.initialReboundPhase = 'complete'
            state.cleanSupportStreak = sample.externalContact ? 0 : 1
          }
          return
        }

        if (floorSupported) {
          state.cleanSupportStreak = sample.externalContact ? 0 : state.cleanSupportStreak + 1
          if (state.cleanSupportStreak >= FLOOR_RELAUNCH_SUPPORT_STEPS) {
            state.secondaryReady = true
          }
          return
        }

        if (state.cleanSupportStreak >= FLOOR_RELAUNCH_SUPPORT_STEPS) {
          state.activeEpisode = {
            airborneSteps: 0,
            peakClearance: 0,
            minimumWorldY: state.lastSupportedWorldY,
            orderedWorldYRise: 0,
            externalContactObserved: false,
            qualifiedBeforeExternalContact: false,
            preExternalPeakClearance: 0,
            preExternalOrderedWorldYRise: 0,
          }
          updateEpisode(state.activeEpisode, sample)
        }
        state.cleanSupportStreak = 0
      })
    },

    finish() {
      states.forEach((state, dieIndex) => finalizeEpisode(dieIndex, state))
      const floorOnly = events.filter(
        (event) =>
          event.airborneSteps >= FLOOR_RELAUNCH_MIN_AIRBORNE_STEPS &&
          !event.externalContactObserved,
      )
      const legacyRanges = states.map((state) =>
        Number.isFinite(state.legacyMinY) && Number.isFinite(state.legacyMaxY)
          ? state.legacyMaxY - state.legacyMinY
          : 0,
      )

      return {
        version: FLOOR_RELAUNCH_TRACKER_VERSION,
        available: true,
        unavailableReason: null,
        initialContactObservedDiceCount: states.filter(
          ({ initialFloorContactEstablished }) => initialFloorContactEstablished,
        ).length,
        armedDiceCount: states.filter(({ secondaryReady }) => secondaryReady).length,
        secondaryEpisodeCount: events.length,
        floorOnlySecondaryEpisodeCount: floorOnly.length,
        relaunchEventCount: events.filter(({ qualifiesAsRelaunch }) => qualifiesAsRelaunch).length,
        maxFloorOnlySecondaryClearance: Math.max(
          0,
          ...floorOnly.map(({ peakClearance }) => peakClearance),
        ),
        maxFloorOnlySecondaryOrderedWorldYRise: Math.max(
          0,
          ...floorOnly.map(({ orderedWorldYRise }) => orderedWorldYRise),
        ),
        maxPreExternalSecondaryClearance: Math.max(
          0,
          ...events.map(({ preExternalPeakClearance }) => preExternalPeakClearance),
        ),
        maxPreExternalSecondaryOrderedWorldYRise: Math.max(
          0,
          ...events.map(({ preExternalOrderedWorldYRise }) => preExternalOrderedWorldYRise),
        ),
        legacyUnorderedPost100WorldYRange: Math.max(0, ...legacyRanges),
        events: events.map((event) => ({ ...event })),
      }
    },
  }
}

export interface BoxFloorFrameSampler {
  available: boolean
  unavailableReason: string | null
  sample: (contacts: readonly CANNON.ContactEquation[]) => FloorRelaunchFrameSample[]
}

/** 当前 runtime Box + Heightfield 的精确顶点 clearance sampler。 */
export function createBoxFloorFrameSampler(
  bodies: readonly CANNON.Body[],
  bottom: CANNON.Body,
): BoxFloorFrameSampler {
  const heightfield = bottom.shapes[0]
  if (!(heightfield instanceof CANNON.Heightfield)) {
    return {
      available: false,
      unavailableReason: 'bowl bottom is not a Heightfield',
      sample: () => [],
    }
  }
  const bottomShapeOffset = bottom.shapeOffsets[0]
  const bottomShapeOrientation = bottom.shapeOrientations[0]
  if (
    bottom.shapes.length !== 1 ||
    !bottomShapeOffset ||
    bottomShapeOffset.x !== 0 ||
    bottomShapeOffset.y !== 0 ||
    bottomShapeOffset.z !== 0 ||
    !bottomShapeOrientation ||
    bottomShapeOrientation.x !== 0 ||
    bottomShapeOrientation.y !== 0 ||
    bottomShapeOrientation.z !== 0 ||
    bottomShapeOrientation.w !== 1
  ) {
    return {
      available: false,
      unavailableReason: 'bowl bottom Heightfield shape must be single and unoffset',
      sample: () => [],
    }
  }

  const verticesByBody: CANNON.Vec3[][] = []
  for (const body of bodies) {
    const shape = body.shapes[0]
    const offset = body.shapeOffsets[0]
    const orientation = body.shapeOrientations[0]
    if (
      body.shapes.length !== 1 ||
      !(shape instanceof CANNON.Box) ||
      !offset ||
      offset.x !== 0 ||
      offset.y !== 0 ||
      offset.z !== 0 ||
      !orientation ||
      orientation.x !== 0 ||
      orientation.y !== 0 ||
      orientation.z !== 0 ||
      orientation.w !== 1
    ) {
      return {
        available: false,
        unavailableReason: 'dice body is not a single, unoffset Box shape',
        sample: () => [],
      }
    }

    const { x, y, z } = shape.halfExtents
    verticesByBody.push(
      [-1, 1].flatMap((sx) =>
        [-1, 1].flatMap((sy) => [-1, 1].map((sz) => new CANNON.Vec3(sx * x, sy * y, sz * z))),
      ),
    )
  }

  const bodyIndices = new Map(bodies.map((body, index) => [body, index]))
  const worldPoint = new CANNON.Vec3()
  const floorPoint = new CANNON.Vec3()

  return {
    available: true,
    unavailableReason: null,
    sample(contacts) {
      const floorContacts = new Array(bodies.length).fill(false) as boolean[]
      const externalContacts = new Array(bodies.length).fill(false) as boolean[]
      for (const contact of contacts) {
        const indexA = bodyIndices.get(contact.bi)
        const indexB = bodyIndices.get(contact.bj)
        if (indexA !== undefined) {
          if (contact.bj === bottom) floorContacts[indexA] = true
          else externalContacts[indexA] = true
        }
        if (indexB !== undefined) {
          if (contact.bi === bottom) floorContacts[indexB] = true
          else externalContacts[indexB] = true
        }
      }

      return bodies.map((body, index) => {
        let floorClearance = Infinity
        for (const vertex of verticesByBody[index]) {
          body.pointToWorldFrame(vertex, worldPoint)
          bottom.pointToLocalFrame(worldPoint, floorPoint)
          const floorHeight = heightfield.getHeightAt(floorPoint.x, floorPoint.y, true)
          floorClearance = Math.min(floorClearance, floorPoint.z - floorHeight)
        }
        return {
          floorContact: floorContacts[index],
          externalContact: externalContacts[index],
          floorClearance,
          worldY: body.position.y,
        }
      })
    },
  }
}

export function unavailableFloorRelaunchDiagnostics(reason: string): FloorRelaunchDiagnostics {
  return {
    version: FLOOR_RELAUNCH_TRACKER_VERSION,
    available: false,
    unavailableReason: reason,
    initialContactObservedDiceCount: 0,
    armedDiceCount: 0,
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
