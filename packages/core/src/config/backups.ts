import type { Problems } from './config-error.ts'
import type { ResolvedBackups } from './types.ts'
import { isRecord, keyPath, wrongType } from './values.ts'

/** The fewest days a site keeps its daily backups for. */
export const BACKUP_RETENTION_MIN_DAYS = 1
/** The most: a year of daily files. Older content lives in an export kept elsewhere. */
export const BACKUP_RETENTION_MAX_DAYS = 365

/** What a site that says nothing gets: a backup each day, kept 30 days. */
export const DEFAULT_BACKUPS: ResolvedBackups = { enabled: true, retentionDays: 30 }

const FIX = 'Declare it as { enabled: true, retentionDays: 30 }, or remove it.'

export function readBackups(path: string, raw: unknown, problems: Problems): ResolvedBackups {
  if (raw === undefined || raw === null) return DEFAULT_BACKUPS
  if (!isRecord(raw)) {
    problems.add(path, wrongType(raw, 'an object'), FIX)
    return DEFAULT_BACKUPS
  }
  let { enabled, retentionDays } = DEFAULT_BACKUPS
  const rawEnabled = raw['enabled']
  if (typeof rawEnabled === 'boolean') enabled = rawEnabled
  else if (rawEnabled !== undefined) {
    problems.add(
      keyPath(path, 'enabled'),
      wrongType(rawEnabled, 'true or false'),
      'Use true to back the site up each day, or false to make no backup.',
    )
  }
  const days = raw['retentionDays']
  if (days !== undefined) {
    if (
      typeof days === 'number' &&
      Number.isInteger(days) &&
      days >= BACKUP_RETENTION_MIN_DAYS &&
      days <= BACKUP_RETENTION_MAX_DAYS
    ) {
      retentionDays = days
    } else {
      problems.add(
        keyPath(path, 'retentionDays'),
        `${typeof days === 'number' ? String(days) : wrongType(days, 'a number')} is not a whole number of days from ${BACKUP_RETENTION_MIN_DAYS} to ${BACKUP_RETENTION_MAX_DAYS}`,
        'Give the days each daily backup is kept, 30 by default.',
      )
    }
  }
  return { enabled, retentionDays }
}
