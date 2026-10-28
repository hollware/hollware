import type { Problems } from './config-error.ts'
import type { ResolvedAudit } from './types.ts'
import { isRecord, keyPath, wrongType } from './values.ts'

/** The fewest days a site may keep its activity log for, when it sets a retention. */
export const AUDIT_RETENTION_MIN_DAYS = 30
/** The most days a retention may be: ten years. Beyond that, keep it with no retention. */
export const AUDIT_RETENTION_MAX_DAYS = 3650

export const DEFAULT_AUDIT: ResolvedAudit = { ipAddresses: 'off', retentionDays: null }

export function readAudit(path: string, raw: unknown, problems: Problems): ResolvedAudit {
  if (raw === undefined || raw === null) return DEFAULT_AUDIT
  if (!isRecord(raw)) {
    problems.add(
      path,
      wrongType(raw, 'an object'),
      'Declare it as { ipAddresses: "off", retentionDays: null }, or remove it.',
    )
    return DEFAULT_AUDIT
  }
  let ipAddresses: ResolvedAudit['ipAddresses'] = 'off'
  const addresses = raw['ipAddresses']
  if (addresses === 'hashed') ipAddresses = 'hashed'
  else if (addresses !== undefined && addresses !== 'off') {
    problems.add(
      keyPath(path, 'ipAddresses'),
      wrongType(addresses, '"off" or "hashed"'),
      'Use "off" to keep no address, or "hashed" to keep a keyed hash of each.',
    )
  }
  let retentionDays: number | null = null
  const days = raw['retentionDays']
  if (days !== undefined && days !== null) {
    if (
      typeof days !== 'number' ||
      !Number.isInteger(days) ||
      days < AUDIT_RETENTION_MIN_DAYS ||
      days > AUDIT_RETENTION_MAX_DAYS
    ) {
      problems.add(
        keyPath(path, 'retentionDays'),
        `${typeof days === 'number' ? String(days) : wrongType(days, 'a number')} is not a whole number of days from ${AUDIT_RETENTION_MIN_DAYS} to ${AUDIT_RETENTION_MAX_DAYS}`,
        'Give the days to keep each line, or null to keep the log for as long as the site exists.',
      )
    } else retentionDays = days
  }
  return { ipAddresses, retentionDays }
}
