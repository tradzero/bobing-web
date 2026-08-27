import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadProjectEnvFile } from './load-env'

const LOADED_KEY = 'DICE_TEST_ENV_FILE_LOADED'
const PRECEDENCE_KEY = 'DICE_TEST_ENV_PRECEDENCE'
const temporaryDirectories: string[] = []

afterEach(() => {
  delete process.env[LOADED_KEY]
  delete process.env[PRECEDENCE_KEY]
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('loadProjectEnvFile', () => {
  it('缺少 .env 时保持可选', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'dice-env-missing-'))
    temporaryDirectories.push(directory)

    expect(loadProjectEnvFile(directory)).toBe(false)
  })

  it('加载 .env 且不覆盖显式进程环境变量', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'dice-env-loaded-'))
    temporaryDirectories.push(directory)
    writeFileSync(
      path.join(directory, '.env'),
      `${LOADED_KEY}=from-file\n${PRECEDENCE_KEY}=from-file\n`,
    )
    process.env[PRECEDENCE_KEY] = 'from-process'

    expect(loadProjectEnvFile(directory)).toBe(true)
    expect(process.env[LOADED_KEY]).toBe('from-file')
    expect(process.env[PRECEDENCE_KEY]).toBe('from-process')
  })
})
