import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve, sep } from 'node:path'

export const REPOSITORY_STATE_SCHEMA_VERSION = 2

export interface RepositoryContentDigest {
  status: 'clean' | 'dirty' | 'unavailable'
  sha256: string | null
  byteLength: number | null
}

export interface RepositoryUntrackedContentDigest {
  status: 'clean' | 'present' | 'unavailable'
  sha256: string | null
  fileCount: number | null
  byteLength: number | null
}

export interface RepositoryState {
  schemaVersion: typeof REPOSITORY_STATE_SCHEMA_VERSION
  head: string
  worktreeDirty: boolean | null
  worktreeStatusSha256: string | null
  trackedDiff: RepositoryContentDigest
  untrackedContent: RepositoryUntrackedContentDigest
}

export interface RepositoryStateInput {
  head: Uint8Array
  porcelainStatus: Uint8Array
  trackedDiff: Uint8Array
  untrackedContent: RepositoryUntrackedContentDigest
}

export interface UntrackedContentEntry {
  /** Git 返回的仓库相对路径原始字节，不经过字符串解码。 */
  path: Uint8Array
  /** 普通文件内容，或 symlink 自身的目标路径字节。 */
  content: Uint8Array
  kind: 'file' | 'symlink'
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function unavailableUntrackedContent(): RepositoryUntrackedContentDigest {
  return { status: 'unavailable', sha256: null, fileCount: null, byteLength: null }
}

function uint64BigEndian(value: number): Buffer {
  const encoded = Buffer.allocUnsafe(8)
  encoded.writeBigUInt64BE(BigInt(value))
  return encoded
}

/**
 * 以原始 path bytes 排序，并使用 kind + uint64 length framing 聚合路径和内容。
 * framing 避免 `(ab,c)` 与 `(a,bc)` 之类的拼接歧义。
 */
export function deriveUntrackedContent(
  entries: readonly UntrackedContentEntry[],
): RepositoryUntrackedContentDigest {
  const sortedEntries = entries
    .map((entry) => ({
      path: Buffer.from(entry.path),
      content: Buffer.from(entry.content),
      kind: entry.kind,
    }))
    .sort((left, right) => Buffer.compare(left.path, right.path))
  const hash = createHash('sha256')
  hash.update('dice-repository-untracked-content-v1\0')
  let byteLength = 0

  for (const entry of sortedEntries) {
    hash.update(entry.kind === 'file' ? Buffer.from([0]) : Buffer.from([1]))
    hash.update(uint64BigEndian(entry.path.byteLength))
    hash.update(entry.path)
    hash.update(uint64BigEndian(entry.content.byteLength))
    hash.update(entry.content)
    byteLength += entry.content.byteLength
  }

  return {
    status: sortedEntries.length > 0 ? 'present' : 'clean',
    sha256: hash.digest('hex'),
    fileCount: sortedEntries.length,
    byteLength,
  }
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
    untrackedContent: input.untrackedContent,
  }
}

function splitNullTerminatedPaths(value: Uint8Array): Buffer[] {
  const bytes = Buffer.from(value)
  const paths: Buffer[] = []
  let start = 0
  for (let index = 0; index < bytes.byteLength; index++) {
    if (bytes[index] !== 0) continue
    if (index > start) paths.push(bytes.subarray(start, index))
    start = index + 1
  }
  if (start !== bytes.byteLength) {
    throw new Error('git ls-files -z 返回了未以 NUL 结束的路径')
  }
  return paths
}

function absoluteRawPath(cwd: string, relativePath: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from(resolve(cwd)), Buffer.from(sep), Buffer.from(relativePath)])
}

function readUntrackedEntry(cwd: string, relativePath: Uint8Array): UntrackedContentEntry {
  const absolutePath = absoluteRawPath(cwd, relativePath)
  const stat = lstatSync(absolutePath)
  if (stat.isSymbolicLink()) {
    return {
      path: relativePath,
      content: readlinkSync(absolutePath, { encoding: 'buffer' }),
      kind: 'symlink',
    }
  }
  if (!stat.isFile()) {
    throw new Error('未跟踪路径不是普通文件或 symlink')
  }
  return { path: relativePath, content: readFileSync(absolutePath), kind: 'file' }
}

type GitRunner = (args: string[]) => Buffer

function readUntrackedContent(cwd: string, runGit: GitRunner): RepositoryUntrackedContentDigest {
  try {
    const paths = splitNullTerminatedPaths(
      runGit(['ls-files', '--others', '--exclude-standard', '-z']),
    )
    return deriveUntrackedContent(paths.map((path) => readUntrackedEntry(cwd, path)))
  } catch {
    return unavailableUntrackedContent()
  }
}

/**
 * tracked diff 取 HEAD 到当前 index/worktree 的合并差异；untracked content 使用
 * `git ls-files --others --exclude-standard -z` 枚举，因此 ignored artifact 不进入摘要。
 * 任一未跟踪内容读取失败只降级该字段，绝不回退成“clean”。
 */
export function readRepositoryState(cwd = process.cwd()): RepositoryState {
  const runGit: GitRunner = (args) =>
    execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  try {
    const head = runGit(['rev-parse', 'HEAD'])
    const porcelainStatus = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    const trackedDiff = runGit([
      'diff',
      '--binary',
      '--full-index',
      '--no-ext-diff',
      '--no-textconv',
      'HEAD',
      '--',
    ])
    return deriveRepositoryState({
      head,
      porcelainStatus,
      trackedDiff,
      untrackedContent: readUntrackedContent(cwd, runGit),
    })
  } catch {
    return {
      schemaVersion: REPOSITORY_STATE_SCHEMA_VERSION,
      head: 'unknown',
      worktreeDirty: null,
      worktreeStatusSha256: null,
      trackedDiff: { status: 'unavailable', sha256: null, byteLength: null },
      untrackedContent: unavailableUntrackedContent(),
    }
  }
}

export function sameRepositoryState(left: RepositoryState, right: RepositoryState): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
