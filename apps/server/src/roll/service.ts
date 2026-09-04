import { randomUUID } from 'node:crypto'
import type { ServerConfig } from '../config/env'
import { RoomRepository, type StartedRoll, type TiltDecisionInput } from '../room/repository'
import { computeAuthoritativeRoll, type RollAuthorityOptions } from './authority'

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
  private readonly repository: RoomRepository
  private readonly authorityOptions: RollAuthorityOptions
  private readonly config: ServerConfig
  private readonly now: () => number

  constructor(
    repository: RoomRepository,
    config: ServerConfig,
    options: { now?: () => number } = {},
  ) {
    this.repository = repository
    this.config = config
    this.authorityOptions = {
      revealMinMs: config.rollRevealMinMs,
      revealMaxMs: config.rollRevealMaxMs,
    }
    this.now = options.now ?? Date.now
  }

  async requestRoll(request: RoomRollRequest): Promise<StartedRoll | null> {
    let commandId = request.commandId
    for (;;) {
      const outcome = computeAuthoritativeRoll(this.authorityOptions)
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
