import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

export const REPOSITORY_STATE_SCHEMA_VERSION = 1

export interface RepositoryState {
  schemaVersion: typeof REPOSITORY_STATE_SCHEMA_VERSION
  head: string
  worktreeDirty: boolean | null
  worktreeStatusSha256: string | null
  trackedDiff: {
    status: 'clean' | 'dirty' | 'unavailable'
    sha256: string | null
    byteLength: number | null
  }
}

export interface RepositoryStateInput {
  head: Uint8Array
  porcelainStatus: Uint8Array
  trackedDiff: Uint8Array
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

/** 把 Git 原始字节纯转换成可写入 artifact 的版本化 provenance。 */
export function deriveRepositoryState(input: RepositoryStateInput): RepositoryState {
  const head = new TextDecoder().decode(input.head).trim()
  return {
    schemaVersion: REPOSITORY_STATE_SCHEMA_VERSION,
    head: head || 'unknown',
    worktreeDirty: input.porcelainStatus.byteLength > 0,
    worktreeStatusSha256: sha256(input.porcelainStatus),
    trackedDiff: {
      status: input.trackedDiff.byteLength > 0 ? 'dirty' : 'clean',
      sha256: sha256(input.trackedDiff),
      byteLength: input.trackedDiff.byteLength,
    },
  }
}

/**
 * tracked diff 取 HEAD 到当前 index/worktree 的合并差异；未跟踪文件只影响 worktreeDirty。
 * 失败时必须显式 unavailable，绝不回退成“clean commit”。
 */
export function readRepositoryState(cwd = process.cwd()): RepositoryState {
  try {
    const runGit = (args: string[]) =>
      execFileSync('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    return deriveRepositoryState({
      head: runGit(['rev-parse', 'HEAD']),
      porcelainStatus: runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      trackedDiff: runGit([
        'diff',
        '--binary',
        '--full-index',
        '--no-ext-diff',
        '--no-textconv',
        'HEAD',
        '--',
      ]),
    })
  } catch {
    return {
      schemaVersion: REPOSITORY_STATE_SCHEMA_VERSION,
      head: 'unknown',
      worktreeDirty: null,
      worktreeStatusSha256: null,
      trackedDiff: { status: 'unavailable', sha256: null, byteLength: null },
    }
  }
}

export function sameRepositoryState(left: RepositoryState, right: RepositoryState): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
