import { randomUUID } from 'node:crypto'
import type { ServerConfig } from '../config/env'
import {
  RoomRepository,
  RoomRepositoryError,
  type StartedRoll,
  type TiltDecisionInput,
} from '../room/repository'
import type { AuthoritativeRoll, RollAuthorityOptions } from './authority'
import { RollWorkerPoolError } from './worker-pool'
type RollRepository = Pick<
  RoomRepository,
  | 'prepareAuthoritativeRoll'
  | 'beginAuthoritativeRoll'
  | 'recordAuthoritativeRollError'
  | 'resolveTiltDecision'
>

export interface RoomRollRequest {
  roomId: string
  playerId: string
  commandId: string
}

/**
 * CPU 物理计算与 PostgreSQL 事务分离：数据库只锁定短暂的校验/提交窗口。
 * 权威计算异常会记录完整诊断；配置允许时由服务端换 seed 自动重试。
 */
export class RoomRollService {
  private readonly repository: RollRepository
  private readonly authorityOptions: RollAuthorityOptions
  private readonly config: ServerConfig
  private readonly compute: (options: RollAuthorityOptions) => Promise<AuthoritativeRoll>
  private readonly inFlight = new Map<string, Promise<StartedRoll | null>>()
  private readonly now: () => number

  constructor(
    repository: RollRepository,
    config: ServerConfig,
    options: {
      now?: () => number
      compute: (options: RollAuthorityOptions) => Promise<AuthoritativeRoll>
    },
  ) {
    this.repository = repository
    this.config = config
    this.authorityOptions = {
      revealMinMs: config.rollRevealMinMs,
      revealMaxMs: config.rollRevealMaxMs,
    }
    this.compute = options.compute
    this.now = options.now ?? Date.now
  }

  requestRoll(request: RoomRollRequest): Promise<StartedRoll | null> {
    const key = JSON.stringify([request.roomId, request.playerId, request.commandId])
    const existing = this.inFlight.get(key)
    if (existing) return existing
    const pending = this.runRequest(request)
      .catch((error: unknown) => {
        if (error instanceof RollWorkerPoolError)
          throw new RoomRepositoryError('conflict', error.message)
        throw error
      })
      .finally(() => this.inFlight.delete(key))
    this.inFlight.set(key, pending)
    return pending
  }

  private async runRequest(request: RoomRollRequest): Promise<StartedRoll | null> {
    let commandId = request.commandId
    for (;;) {
      const duplicate = await this.repository.prepareAuthoritativeRoll({
        ...request,
        commandId,
        now: this.now(),
      })
      if (duplicate) return duplicate
      const outcome = await this.compute(this.authorityOptions)
      const now = this.now()
      if (outcome.kind === 'error') {
        const recorded = await this.repository.recordAuthoritativeRollError({
          roomId: request.roomId,
          playerId: request.playerId,
          commandId,
          now,
          seed: outcome.seed,
          settleReason: outcome.settleReason,
          errorReason: outcome.errorReason ?? 'unknown-authority-error',
          throwAlgorithmVersion: String(outcome.throwAlgorithmVersion),
          settleAlgorithmVersion: String(outcome.settleAlgorithmVersion),
          diagnostics: outcome.diagnostics,
          timing: this.config.timing,
        })
        if (!recorded.shouldAutoRetry) return null
        commandId = randomUUID()
        continue
      }

      return this.repository.beginAuthoritativeRoll({
        roomId: request.roomId,
        playerId: request.playerId,
        commandId,
        now,
        seed: outcome.seed,
        diceValues: outcome.diceValues,
        settleReason: outcome.settleReason,
        revealAt: now + outcome.revealDelayMs,
        throwAlgorithmVersion: String(outcome.throwAlgorithmVersion),
        settleAlgorithmVersion: String(outcome.settleAlgorithmVersion),
        diagnostics: outcome.diagnostics,
        requiresTiltDecision: outcome.kind === 'tilt-decision',
      })
    }
  }

  async resolveTiltDecision(
    input: Omit<TiltDecisionInput, 'now' | 'timing'>,
  ): Promise<StartedRoll | null> {
    await this.repository.resolveTiltDecision({
      ...input,
      now: this.now(),
      timing: this.config.timing,
    })
    if (input.decision === 'accept') return null
    return this.requestRoll({
      roomId: input.roomId,
      playerId: input.playerId,
      commandId: randomUUID(),
    })
  }
}
