// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { deriveRepositoryState } from './repository-state'

const bytes = (value: string) => new TextEncoder().encode(value)
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

describe('repository artifact provenance', () => {
  it('记录完整 HEAD，并分别标记工作树与 tracked diff 的状态和哈希', () => {
    const diff = 'diff --git a/file.ts b/file.ts\n-old\n+new\n'
    const status = ' M file.ts\0?? untracked.txt\0'

    expect(
      deriveRepositoryState({
        head: bytes('0123456789abcdef0123456789abcdef01234567\n'),
        porcelainStatus: bytes(status),
        trackedDiff: bytes(diff),
      }),
    ).toEqual({
      schemaVersion: 1,
      head: '0123456789abcdef0123456789abcdef01234567',
      worktreeDirty: true,
      worktreeStatusSha256: sha256(status),
      trackedDiff: {
        status: 'dirty',
        sha256: sha256(diff),
        byteLength: bytes(diff).byteLength,
      },
    })
  })

  it('只有未跟踪文件时不会伪造 tracked diff，完全干净时保留空内容哈希', () => {
    const untrackedOnly = deriveRepositoryState({
      head: bytes('abc\n'),
      porcelainStatus: bytes('?? artifact.json\0'),
      trackedDiff: bytes(''),
    })
    const clean = deriveRepositoryState({
      head: bytes('abc\n'),
      porcelainStatus: bytes(''),
      trackedDiff: bytes(''),
    })

    expect(untrackedOnly).toMatchObject({
      worktreeDirty: true,
      trackedDiff: { status: 'clean', sha256: sha256(''), byteLength: 0 },
    })
    expect(clean).toMatchObject({
      worktreeDirty: false,
      trackedDiff: { status: 'clean', sha256: sha256(''), byteLength: 0 },
    })
  })
})
