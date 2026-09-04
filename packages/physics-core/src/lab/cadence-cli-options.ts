import {
  CADENCE_DEFAULT_BASE_SEED,
  CADENCE_DEFAULT_TOTAL_SEEDS,
  type CadenceComparisonRequest,
} from './cadence-comparison'

export interface PhysicsCadenceCliOptions extends CadenceComparisonRequest {
  json: boolean
  output?: string
  requireClean: boolean
  help: boolean
}

function parseSafeInteger(name: string, value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`--${name} 必须是安全整数，收到 ${value}`)
  }
  return parsed
}

function parsePositiveInteger(name: string, value: string): number {
  const parsed = parseSafeInteger(name, value)
  if (parsed <= 0) throw new RangeError(`--${name} 必须是正整数，收到 ${value}`)
  return parsed
}

/** CLI 只允许改变 seed 范围和输出，不开放可削弱 versioned matrix 的参数。 */
export function parsePhysicsCadenceArgs(args: readonly string[]): PhysicsCadenceCliOptions {
  const values = new Map<string, string>()
  const flags = new Set<string>()
  const valueKeys = new Set(['seeds', 'base-seed', 'seed', 'output'])
  const flagKeys = new Set(['watch-only', 'json', 'require-clean', 'help'])

  for (const arg of args) {
    const match = arg.match(/^--([\w-]+)(?:=(.*))?$/)
    if (!match) throw new Error(`不支持的参数格式：${arg}`)
    const [, key, value] = match
    if (!valueKeys.has(key) && !flagKeys.has(key)) throw new Error(`不支持的参数：--${key}`)
    if (values.has(key) || flags.has(key)) throw new Error(`参数重复：--${key}`)
    if (valueKeys.has(key)) {
      if (value === undefined || value.length === 0) throw new Error(`--${key} 必须提供值`)
      values.set(key, value)
    } else {
      if (value !== undefined) throw new Error(`--${key} 是 flag，不接受值`)
      flags.add(key)
    }
  }

  if (values.has('seed') && flags.has('watch-only')) {
    throw new Error('--seed 与 --watch-only 不能同时使用')
  }
  if (values.has('seed') && values.has('seeds')) {
    throw new Error('--seed 与 --seeds 不能同时使用')
  }

  return {
    totalSeeds: parsePositiveInteger(
      'seeds',
      values.get('seeds') ?? String(CADENCE_DEFAULT_TOTAL_SEEDS),
    ),
    baseSeed: parseSafeInteger(
      'base-seed',
      values.get('base-seed') ?? String(CADENCE_DEFAULT_BASE_SEED),
    ),
    watchOnly: flags.has('watch-only'),
    seed: values.has('seed') ? parseSafeInteger('seed', values.get('seed')!) : undefined,
    json: flags.has('json'),
    output: values.get('output'),
    requireClean: flags.has('require-clean'),
    help: flags.has('help'),
  }
}
