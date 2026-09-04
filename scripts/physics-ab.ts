import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { PHYSICS } from '../apps/web/src/config/physics.ts'
import { SETTLE } from '../apps/web/src/config/settle.ts'
import { THROW } from '../apps/web/src/config/throw.ts'
import {
  PHYSICS_VARIANT_SCHEMA_VERSION,
  PHYSICS_VARIANT_IDS,
} from '../apps/web/src/config/physics-variants.ts'
import { THROW_ALGORITHM_VERSION, THROW_RANDOM_PLAN_VERSION } from '../apps/web/src/dice/throw.ts'
import { SETTLE_ALGORITHM_VERSION } from '../apps/web/src/dice/settle.ts'
import { ESCAPE_GUARD_VERSION } from '../apps/web/src/physics/escape-guard.ts'
import {
  FLOOR_RELAUNCH_CLEARANCE_THRESHOLD,
  FLOOR_RELAUNCH_SUPPORT_CLEARANCE_TOLERANCE,
  FLOOR_RELAUNCH_TRACKER_VERSION,
  FLOOR_RELAUNCH_WORLD_Y_RISE_THRESHOLD,
} from '../apps/web/src/physics/floor-relaunch.ts'
import { ROLL_DIAGNOSTICS_SCHEMA_VERSION, runRoll } from '@dice/physics-core'
import {
  PHYSICS_AB_SCHEMA_VERSION,
  buildPhysicsAbSeedSet,
  executePhysicsAb,
  parsePhysicsAbArgs,
  resolvePhysicsAbVariants,
  type PhysicsAbSummary,
  type RollSummary,
} from '../apps/web/src/physics/roll-comparison.ts'

const HELP = `用法：pnpm test:physics:ab -- [options]

  --baseline=<preset>       默认 historical
  --candidate=<preset>      默认 current
  --seeds=<count>           watch + 批量 seed 的总数，默认 200
  --base-seed=<seed>        批量 seed 起点，默认 50000
  --watch-seeds=<a,b,...>   覆盖固定 watch seeds；none 表示空
  --json                     包含每个 seed 的完整 diff（默认只打印汇总）
  --help

presets: ${PHYSICS_VARIANT_IDS.join(', ')}
`

function currentCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

function cannonVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const manifest = require('cannon-es/package.json') as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

function compactRollSummary(summary: RollSummary) {
  const compact: Partial<RollSummary> = { ...summary }
  delete compact.faceCountsByDie
  delete compact.sumCounts
  return compact
}

function compactSummary(summary: PhysicsAbSummary) {
  return {
    ...summary,
    baseline: compactRollSummary(summary.baseline),
    candidate: compactRollSummary(summary.candidate),
    cohorts: {
      watch: {
        ...summary.cohorts.watch,
        baseline: summary.cohorts.watch.baseline
          ? compactRollSummary(summary.cohorts.watch.baseline)
          : null,
        candidate: summary.cohorts.watch.candidate
          ? compactRollSummary(summary.cohorts.watch.candidate)
          : null,
      },
      batch: {
        ...summary.cohorts.batch,
        baseline: summary.cohorts.batch.baseline
          ? compactRollSummary(summary.cohorts.batch.baseline)
          : null,
        candidate: summary.cohorts.batch.candidate
          ? compactRollSummary(summary.cohorts.batch.candidate)
          : null,
      },
    },
  }
}

function main(): void {
  const includeRolls = process.argv.includes('--json')
  const options = parsePhysicsAbArgs(process.argv.slice(2).filter((arg) => arg !== '--json'))
  if (options.help) {
    console.log(HELP)
    return
  }

  const seeds = buildPhysicsAbSeedSet(options)
  const variants = resolvePhysicsAbVariants(options)
  const report = executePhysicsAb({
    seeds,
    watchSeeds: options.watchSeeds,
    ...variants,
    runRoll,
  })

  const output = {
    metadata: {
      schemaVersion: PHYSICS_AB_SCHEMA_VERSION,
      variantSchemaVersion: PHYSICS_VARIANT_SCHEMA_VERSION,
      rollDiagnosticsSchemaVersion: ROLL_DIAGNOSTICS_SCHEMA_VERSION,
      commit: currentCommit(),
      node: process.version,
      cannonEs: cannonVersion(),
      algorithms: {
        prng: 'mulberry32',
        throw: THROW_ALGORITHM_VERSION,
        throwRandomPlan: THROW_RANDOM_PLAN_VERSION,
        settle: SETTLE_ALGORITHM_VERSION,
        escapeGuard: ESCAPE_GUARD_VERSION,
        floorRelaunch: FLOOR_RELAUNCH_TRACKER_VERSION,
      },
      floorRelaunch: {
        supportClearanceTolerance: FLOOR_RELAUNCH_SUPPORT_CLEARANCE_TOLERANCE,
        clearanceThreshold: FLOOR_RELAUNCH_CLEARANCE_THRESHOLD,
        orderedWorldYRiseThreshold: FLOOR_RELAUNCH_WORLD_Y_RISE_THRESHOLD,
      },
      executionPattern: 'AB/BA alternating by seed',
      requested: options,
      seeds,
      variants,
      physics: PHYSICS,
      throw: THROW,
      settle: SETTLE,
      budgets: report.budgets,
    },
    summary: report.summary,
    diffs: report.diffs,
    failureSeeds: report.failureSeeds,
  }
  const compactMetadata = {
    schemaVersion: output.metadata.schemaVersion,
    variantSchemaVersion: output.metadata.variantSchemaVersion,
    rollDiagnosticsSchemaVersion: output.metadata.rollDiagnosticsSchemaVersion,
    commit: output.metadata.commit,
    node: output.metadata.node,
    cannonEs: output.metadata.cannonEs,
    algorithms: output.metadata.algorithms,
    floorRelaunch: output.metadata.floorRelaunch,
    executionPattern: output.metadata.executionPattern,
    requested: output.metadata.requested,
    variants: output.metadata.variants,
    budgets: output.metadata.budgets,
  }
  const printable = includeRolls
    ? output
    : {
        metadata: compactMetadata,
        summary: compactSummary(output.summary),
        failureSeeds: output.failureSeeds,
      }
  process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`)
  if (!report.summary.passed) process.exitCode = 1
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 2
}
