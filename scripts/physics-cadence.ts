import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { arch, platform } from 'node:process'
import { CANONICAL_BODY_STATE_VERSION } from '../apps/web/src/dice/canonical-body-state.ts'
import { THROW_ALGORITHM_VERSION, THROW_RANDOM_PLAN_VERSION } from '../apps/web/src/dice/throw.ts'
import { ESCAPE_GUARD_VERSION } from '../apps/web/src/physics/escape-guard.ts'
import {
  FLOOR_RELAUNCH_TRACKER_VERSION,
  FLOOR_RELAUNCH_SUPPORT_CLEARANCE_TOLERANCE,
  FLOOR_RELAUNCH_CLEARANCE_THRESHOLD,
  FLOOR_RELAUNCH_WORLD_Y_RISE_THRESHOLD,
} from '../apps/web/src/physics/floor-relaunch.ts'
import { SETTLE_ALGORITHM_VERSION } from '../apps/web/src/dice/settle.ts'
import { ROLL_DIAGNOSTICS_SCHEMA_VERSION } from '../apps/web/src/physics/roll-runner.ts'
import {
  CADENCE_COMPARISON_SCHEMA_VERSION,
  CADENCE_EXECUTION_PLAN_VERSION,
  createCadenceComparisonPlan,
  executeCadenceComparison,
  type CadenceComparisonCoreReport,
  type CadenceComparisonFailure,
} from '../apps/web/src/physics/cadence-comparison.ts'
import { parsePhysicsCadenceArgs } from '../apps/web/src/physics/cadence-cli-options.ts'
import {
  CADENCE_ROLL_REPORT_SCHEMA_VERSION,
  CADENCE_TIME_CONSERVATION_VERSION,
} from '../apps/web/src/physics/cadence-roll-runner.ts'
import {
  PHYSICS_CADENCES,
  PHYSICS_CADENCE_SCHEMA_VERSION,
  PHYSICS_CADENCE_SCHEDULERS,
} from '../apps/web/src/config/physics-cadence.ts'
import { FIXED_STEP_ACCUMULATOR_VERSION } from '../apps/web/src/game/fixed-step-accumulator.ts'
import { PHYSICS } from '../apps/web/src/config/physics.ts'
import { SETTLE } from '../apps/web/src/config/settle.ts'
import { THROW } from '../apps/web/src/config/throw.ts'
import {
  HF_GRID_SIZE,
  WALL_COUNT,
  WALL_HEIGHT,
  WALL_RADIUS,
  WALL_THICKNESS,
} from '../apps/web/src/physics/bowl-body.ts'
import {
  readRepositoryState,
  sameRepositoryState,
  type RepositoryState,
} from '../tooling/repository-state.ts'

const HELP = `用法：pnpm test:physics:cadence -- [options]

  --seeds=<count>       总 seed 数，包含固定 20 个 watch seeds；默认 200
  --base-seed=<seed>    batch seed 起点；默认 50000
  --watch-only          只跑固定 watch 完整矩阵和 overload
  --seed=<seed>         单 seed 完整 watch 矩阵复现
  --json                stdout 输出完整 compact comparisons
  --output=<path>       另写完整 JSON artifact
  --require-clean       起点必须是可读取的 clean worktree
  --help

矩阵由 schema v1 固定，CLI 不提供 cadence/scheduler 削弱开关。
`

function cannonVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const manifest = require('cannon-es/package.json') as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

function repositoryReadable(state: RepositoryState): boolean {
  return (
    state.head !== 'unknown' &&
    state.worktreeDirty !== null &&
    state.trackedDiff.status !== 'unavailable' &&
    state.untrackedContent.status !== 'unavailable'
  )
}

function provenanceFailure(
  code: 'repository-state-changed' | 'repository-not-clean',
  message: string,
): CadenceComparisonFailure {
  return {
    code,
    cohort: 'global',
    seed: null,
    cadence: null,
    scheduler: null,
    role: 'global',
    message,
  }
}

function appendFailures(
  report: CadenceComparisonCoreReport,
  additions: CadenceComparisonFailure[],
): void {
  if (additions.length === 0) return
  report.failures.push(...additions)
  report.summary.failureCount = report.failures.length
  report.summary.passed = false
}

function writeArtifact(path: string, value: unknown): void {
  const absolute = resolve(path)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function main(): void {
  const options = parsePhysicsCadenceArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(HELP)
    return
  }

  const repositoryStart = readRepositoryState()
  if (!repositoryReadable(repositoryStart)) {
    throw new Error('无法读取完整 repository provenance，不能形成可信 cadence report')
  }
  if (options.requireClean && repositoryStart.worktreeDirty) {
    throw new Error('--require-clean 要求运行起点 worktree clean')
  }

  const plan = createCadenceComparisonPlan(options)
  const core = executeCadenceComparison({
    plan,
    onProgress(completed, expected, execution) {
      if (completed === expected || completed % 20 === 0) {
        process.stderr.write(
          `[cadence] ${completed}/${expected} seed=${execution.seed} ${execution.cadence}/${execution.scheduler}\n`,
        )
      }
    },
  })
  const repositoryEnd = readRepositoryState()
  const unchangedDuringRun = sameRepositoryState(repositoryStart, repositoryEnd)
  const provenanceFailures: CadenceComparisonFailure[] = []
  if (!repositoryReadable(repositoryEnd) || !unchangedDuringRun) {
    provenanceFailures.push(
      provenanceFailure('repository-state-changed', 'repository state 在 cadence 长跑期间改变'),
    )
  }
  appendFailures(core, provenanceFailures)

  const artifact = {
    schemaVersion: CADENCE_COMPARISON_SCHEMA_VERSION,
    metadata: {
      reportSchemaVersion: CADENCE_COMPARISON_SCHEMA_VERSION,
      executionPlanVersion: CADENCE_EXECUTION_PLAN_VERSION,
      cadenceRollReportSchemaVersion: CADENCE_ROLL_REPORT_SCHEMA_VERSION,
      cadenceTimeConservationVersion: CADENCE_TIME_CONSERVATION_VERSION,
      cadenceDefinitionSchemaVersion: PHYSICS_CADENCE_SCHEMA_VERSION,
      accumulatorVersion: FIXED_STEP_ACCUMULATOR_VERSION,
      rollDiagnosticsSchemaVersion: ROLL_DIAGNOSTICS_SCHEMA_VERSION,
      canonicalBodyStateVersion: CANONICAL_BODY_STATE_VERSION,
      node: process.version,
      platform: platform,
      arch: arch,
      cannonEs: cannonVersion(),
      algorithms: {
        prng: 'mulberry32',
        throw: THROW_ALGORITHM_VERSION,
        throwRandomPlan: THROW_RANDOM_PLAN_VERSION,
        settle: SETTLE_ALGORITHM_VERSION,
        escapeGuard: ESCAPE_GUARD_VERSION,
        floorRelaunch: FLOOR_RELAUNCH_TRACKER_VERSION,
      },
      repository: { start: repositoryStart, end: repositoryEnd, unchangedDuringRun },
      requested: options,
      executionPattern: 'serial by seed; one reference then candidates; watch overload last',
      evidenceBoundary:
        'watch: full five-cadence/two-cap matrix; batch: one balanced cadence/two caps per seed',
      config: {
        physics: PHYSICS,
        throw: THROW,
        settle: SETTLE,
        cadences: PHYSICS_CADENCES,
        schedulers: PHYSICS_CADENCE_SCHEDULERS,
        bowl: {
          heightfieldGridSize: HF_GRID_SIZE,
          wallCount: WALL_COUNT,
          wallRadius: WALL_RADIUS,
          wallHeight: WALL_HEIGHT,
          wallThickness: WALL_THICKNESS,
        },
        floorRelaunch: {
          supportClearanceTolerance: FLOOR_RELAUNCH_SUPPORT_CLEARANCE_TOLERANCE,
          clearanceThreshold: FLOOR_RELAUNCH_CLEARANCE_THRESHOLD,
          orderedWorldYRiseThreshold: FLOOR_RELAUNCH_WORLD_Y_RISE_THRESHOLD,
        },
      },
    },
    ...core,
  }

  if (options.output) writeArtifact(options.output, artifact)
  const printable = options.json
    ? artifact
    : {
        schemaVersion: artifact.schemaVersion,
        metadata: artifact.metadata,
        plan: {
          version: plan.version,
          watchSeeds: plan.watchSeeds,
          batchSeedCount: plan.batchSeeds.length,
          totalSeeds: plan.totalSeeds,
          comparisonCount: plan.comparisonCount,
          expectedRunCount: plan.expectedRunCount,
        },
        cohorts: core.cohorts,
        summary: core.summary,
        failures: core.failures,
        failureSeeds: core.failureSeeds,
      }
  process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`)
  if (!core.summary.passed) process.exitCode = 1
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 2
}
