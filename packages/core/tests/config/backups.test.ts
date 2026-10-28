import { describe, expect, it } from 'vite-plus/test'

import { DEFAULT_BACKUPS, readBackups } from '../../src/config/backups.ts'
import { Problems } from '../../src/config/config-error.ts'

describe('readBackups', () => {
  it('reads the backup setting, and refuses what is out of range with a fix', () => {
    const problems = new Problems()
    expect([
      readBackups('backups', undefined, problems),
      readBackups('backups', { enabled: false }, problems),
      readBackups('backups', { retentionDays: 365 }, problems),
      readBackups('backups', { retentionDays: 1 }, problems),
    ]).toEqual([
      { enabled: true, retentionDays: 30 },
      { enabled: false, retentionDays: 30 },
      { enabled: true, retentionDays: 365 },
      { enabled: true, retentionDays: 1 },
    ])
    expect(problems.list).toEqual([])

    for (const raw of [
      { enabled: 'no' },
      { retentionDays: 0 },
      { retentionDays: 366 },
      { retentionDays: 7.5 },
    ]) {
      expect(readBackups('backups', raw, problems)).toEqual(DEFAULT_BACKUPS)
    }
    expect(readBackups('backups', 'daily', problems)).toEqual(DEFAULT_BACKUPS)
    expect(problems.list.map((problem) => problem.path)).toEqual([
      'backups.enabled',
      'backups.retentionDays',
      'backups.retentionDays',
      'backups.retentionDays',
      'backups',
    ])
    expect(problems.list.every((problem) => problem.fix.length > 0)).toBe(true)
  })
})
