import { randomInt } from 'node:crypto'
import {
  SETTLE_ALGORITHM_VERSION,
  THROW_ALGORITHM_VERSION,
  runRoll,
  serializeRollResult,
  type RollRunResult,
} from '@dice/physics-core'

export type AuthoritativeRollKind = 'committable' | 'tilt-decision' | 'error'

export interface AuthoritativeRoll {
  seed: number
  kind: AuthoritativeRollKind
  diceValues: number[]
  settleReason: RollRunResult['settleReason']
  settleTime: number
  revealDelayMs: number
  throwAlgorithmVersion: typeof THROW_ALGORITHM_VERSION
  settleAlgorithmVersion: typeof SETTLE_ALGORITHM_VERSION
  diagnostics: Record<string, unknown>
  errorReason: string | null
}

export interface RollAuthorityOptions {
  revealMinMs: number
  revealMaxMs: number
}

function safetyError(result: RollRunResult): string | null {
  if (
    result.settleReason === 'timeout' ||
    result.settleReason === 'frame-budget-exhausted' ||
    result.settleReason === 'continuation-budget-exhausted'
  ) {
    return result.settleReason
  }
  if (result.nanDetected) return 'non-finite-state'
  if (result.wallCenterCrossings > 0) return 'wall-boundary-crossing'
  if (result.escapeGuardInterventionCount > 0) return 'escape-guard-intervention'
  if (result.floorRelaunch.unavailableReason) return 'floor-relaunch-unavailable'
  if (result.floorRelaunch.relaunchEventCount > 0) return 'floor-relaunch-event'
  return null
}

export class RollAuthority {
  private readonly options: RollAuthorityOptions

  constructor(options: RollAuthorityOptions) {
    this.options = options
  }

  compute(seed = randomInt(0, 0x1_0000_0000)): AuthoritativeRoll {
    const result = runRoll({ seed })
    const errorReason = safetyError(result)
    const revealDelayMs = Math.min(
      this.options.revealMaxMs,
      Math.max(this.options.revealMinMs, Math.ceil(result.settleTime * 1_000)),
    )
    return {
      seed,
      kind: errorReason ? 'error' : result.ambiguousDiceCount > 0 ? 'tilt-decision' : 'committable',
      diceValues: result.finalFaces.map(({ value }) => value),
      settleReason: result.settleReason,
      settleTime: result.settleTime,
      revealDelayMs,
      throwAlgorithmVersion: THROW_ALGORITHM_VERSION,
      settleAlgorithmVersion: SETTLE_ALGORITHM_VERSION,
      diagnostics: serializeRollResult(result),
      errorReason,
    }
  }
}
