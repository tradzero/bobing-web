// @vitest-environment node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deriveRepositoryState,
  deriveUntrackedContent,
  readRepositoryState,
  sameRepositoryState,
} from './repository-state'

const bytes = (value: string) => new TextEncoder().encode(value)
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const temporaryRepositories: string[] = []

function createTemporaryRepository(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'dice-repository-state-'))
  temporaryRepositories.push(cwd)
  execFileSync('git', ['init', '-q'], { cwd })
  writeFileSync(join(cwd, '.gitignore'), 'artifacts/\n')
  writeFileSync(join(cwd, 'tracked.txt'), 'tracked\n')
  execFileSync('git', ['add', '.'], { cwd })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Repository State Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-qm',
      'initial',
    ],
    { cwd },
  )
  return cwd
}

afterEach(() => {
  for (const cwd of temporaryRepositories.splice(0)) {
    rmSync(cwd, { recursive: true, force: true })
  }
})

describe('repository artifact provenance', () => {
  it('记录完整 HEAD，并分别标记工作树、tracked diff 与 untracked 内容', () => {
    const diff = 'diff --git a/file.ts b/file.ts\n-old\n+new\n'
    const status = ' M file.ts\0?? untracked.txt\0'
    const untrackedContent = deriveUntrackedContent([
      { path: bytes('untracked.txt'), content: bytes('content'), kind: 'file' },
    ])

    expect(
      deriveRepositoryState({
        head: bytes('0123456789abcdef0123456789abcdef01234567\n'),
        porcelainStatus: bytes(status),
        trackedDiff: bytes(diff),
        untrackedContent,
      }),
    ).toEqual({
      schemaVersion: 2,
      head: '0123456789abcdef0123456789abcdef01234567',
      worktreeDirty: true,
      worktreeStatusSha256: sha256(status),
      trackedDiff: {
        status: 'dirty',
        sha256: sha256(diff),
        byteLength: bytes(diff).byteLength,
      },
      untrackedContent,
    })
  })

  it('以原始路径字节稳定排序并用 length framing 消除拼接歧义', () => {
    const first = deriveUntrackedContent([
      { path: bytes('z'), content: bytes('last'), kind: 'file' },
      { path: Uint8Array.of(0x61, 0xff), content: bytes('raw'), kind: 'file' },
    ])
    const reordered = deriveUntrackedContent([
      { path: Uint8Array.of(0x61, 0xff), content: bytes('raw'), kind: 'file' },
      { path: bytes('z'), content: bytes('last'), kind: 'file' },
    ])
    const ambiguousWithoutFraming = deriveUntrackedContent([
      { path: bytes('z'), content: bytes('las'), kind: 'file' },
      { path: Uint8Array.of(0x61, 0xff), content: bytes('traw'), kind: 'file' },
    ])

    expect(first).toEqual(reordered)
    expect(first).toMatchObject({ status: 'present', fileCount: 2, byteLength: 7 })
    expect(first.sha256).not.toBe(ambiguousWithoutFraming.sha256)
    expect(deriveUntrackedContent([])).toMatchObject({
      status: 'clean',
      fileCount: 0,
      byteLength: 0,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('已有 untracked 路径内容改变时，路径状态相同但仓库状态不再相同', () => {
    const cwd = createTemporaryRepository()
    const untrackedPath = join(cwd, 'existing-untracked.txt')
    writeFileSync(untrackedPath, 'before\n')
    const before = readRepositoryState(cwd)
    writeFileSync(untrackedPath, 'after with different bytes\n')
    const after = readRepositoryState(cwd)

    expect(before.worktreeStatusSha256).toBe(after.worktreeStatusSha256)
    expect(before.untrackedContent).toMatchObject({
      status: 'present',
      fileCount: 1,
      byteLength: 7,
    })
    expect(after.untrackedContent).toMatchObject({
      status: 'present',
      fileCount: 1,
      byteLength: 27,
    })
    expect(before.untrackedContent.sha256).not.toBe(after.untrackedContent.sha256)
    expect(sameRepositoryState(before, after)).toBe(false)
  })

  it('ignored artifact 不进入摘要，并对 symlink 哈希目标字节而不是目标文件内容', () => {
    const cwd = createTemporaryRepository()
    mkdirSync(join(cwd, 'artifacts'), { recursive: true })
    writeFileSync(join(cwd, 'artifacts', 'ignored.json'), '{"run":1}\n')
    writeFileSync(join(cwd, 'target-a.txt'), 'same target contents\n')
    writeFileSync(join(cwd, 'target-b.txt'), 'same target contents\n')
    symlinkSync('target-a.txt', join(cwd, 'untracked-link'))

    const before = readRepositoryState(cwd)
    rmSync(join(cwd, 'untracked-link'))
    symlinkSync('target-b.txt', join(cwd, 'untracked-link'))
    const afterLinkTargetChange = readRepositoryState(cwd)
    writeFileSync(join(cwd, 'artifacts', 'ignored.json'), '{"run":2,"changed":true}\n')
    const afterIgnoredChange = readRepositoryState(cwd)

    expect(before.untrackedContent).toMatchObject({ status: 'present', fileCount: 3 })
    expect(before.untrackedContent.sha256).not.toBe(afterLinkTargetChange.untrackedContent.sha256)
    expect(afterIgnoredChange).toEqual(afterLinkTargetChange)
  })

  it('不在 Git 仓库或未跟踪内容读取失败时显式 unavailable', () => {
    const notARepository = mkdtempSync(join(tmpdir(), 'dice-not-repository-'))
    temporaryRepositories.push(notARepository)
    expect(readRepositoryState(notARepository)).toMatchObject({
      schemaVersion: 2,
      head: 'unknown',
      trackedDiff: { status: 'unavailable' },
      untrackedContent: {
        status: 'unavailable',
        sha256: null,
        fileCount: null,
        byteLength: null,
      },
    })

    const cwd = createTemporaryRepository()
    const unreadablePath = join(cwd, 'unreadable.txt')
    writeFileSync(unreadablePath, 'cannot read this\n')
    chmodSync(unreadablePath, 0)
    const unreadable = readRepositoryState(cwd)
    expect(unreadable.head).not.toBe('unknown')
    expect(unreadable.trackedDiff.status).toBe('clean')
    expect(unreadable.untrackedContent).toEqual({
      status: 'unavailable',
      sha256: null,
      fileCount: null,
      byteLength: null,
    })
  })
})
