import { AUDIT_RETENTION_MAX_DAYS, AUDIT_RETENTION_MIN_DAYS } from '@hollware/core'

/**
 * The logic of the Activity page and of the activity section of Site (ADR-037), apart from the
 * pages so a test can hold it: the query a set of filters makes, who a line names, and the
 * retention an owner types.
 */

/** A line of the log, as `GET /v1/admin/activity` answers it. */
export interface ActivityLine {
  readonly id: string
  readonly at: string
  readonly action: string
  readonly outcome: 'ok' | 'denied' | 'failed'
  readonly errorCode: string | null
  readonly actor: {
    readonly kind: 'user' | 'token' | 'oauth_client' | 'system'
    readonly userId: string | null
    readonly name: string | null
    readonly tokenId: string | null
    readonly tokenLabel: string | null
    readonly clientId: string | null
    readonly declared: Readonly<Record<string, unknown>> | null
  }
  readonly target: { readonly type: string; readonly id: string } | null
  readonly detail: Readonly<Record<string, unknown>> | null
  readonly requestId: string | null
  readonly ipHash: string | null
}

export interface ActivityPage {
  readonly lines: ActivityLine[]
  readonly nextCursor: string | null
}

/** What the person filters by: dates are `YYYY-MM-DD` as a date input gives them. */
export interface ActivityFilters {
  readonly actor?: string
  readonly action?: string
  readonly from?: string
  readonly to?: string
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** The instant a day starts at, in UTC, or `null` when the text is no day. */
function startOf(day: string, plusDays = 0): string | null {
  const parts = DAY.exec(day)
  if (parts === null) return null
  const time = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]) + plusDays)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

/**
 * The query string of a request for the log (without the `?`). `from` is the start of its day and
 * `to`, which the server takes as exclusive, the start of the day after the one chosen, so the day
 * chosen is in the range.
 */
export function activityQuery(
  filters: ActivityFilters,
  paging: { readonly cursor?: string | null; readonly limit?: number } = {},
): string {
  const query = new URLSearchParams()
  if (filters.actor) query.set('actor', filters.actor)
  if (filters.action) query.set('action', filters.action)
  const from = filters.from ? startOf(filters.from) : null
  if (from !== null) query.set('from', from)
  const to = filters.to ? startOf(filters.to, 1) : null
  if (to !== null) query.set('to', to)
  if (paging.limit !== undefined) query.set('limit', String(paging.limit))
  if (paging.cursor) query.set('cursor', paging.cursor)
  return query.toString()
}

export interface Who {
  readonly kind: ActivityLine['actor']['kind']
  /** The name to show; `null` for the deployment, which the page names in its own words. */
  readonly name: string | null
  /** The name the client declared for itself, shown as its claim; `null` when it gave none. */
  readonly via: string | null
}

/** Who a line names: the person, the token's label or the app's id, whichever the actor is. */
export function whoOf(line: ActivityLine): Who {
  const { actor } = line
  const declared = actor.declared?.['name']
  const via = typeof declared === 'string' && declared !== '' ? declared : null
  switch (actor.kind) {
    case 'user':
      return { kind: 'user', name: actor.name ?? actor.userId, via }
    case 'token':
      return { kind: 'token', name: actor.tokenLabel ?? actor.tokenId, via }
    case 'oauth_client':
      return { kind: 'oauth_client', name: actor.clientId, via }
    case 'system':
      return { kind: 'system', name: null, via }
  }
}

/** A target as `type · short id`: the id is a prefix and 26 characters; the end tells them apart. */
export function targetLabel(target: ActivityLine['target']): string {
  if (target === null) return '—'
  const id = target.id.length > 12 ? `…${target.id.slice(-8)}` : target.id
  return `${target.type} · ${id}`
}

export type Retention =
  | { readonly ok: true; readonly days: number | null }
  | { readonly ok: false; readonly min: number; readonly max: number }

/** The retention the form holds: forever, or a whole number of days from 30 to 3650. */
export function parseRetention(
  forever: boolean,
  days: number | string | null | undefined,
): Retention {
  if (forever) return { ok: true, days: null }
  const value = typeof days === 'string' ? (days.trim() === '' ? Number.NaN : Number(days)) : days
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= AUDIT_RETENTION_MIN_DAYS &&
    value <= AUDIT_RETENTION_MAX_DAYS
  ) {
    return { ok: true, days: value }
  }
  return { ok: false, min: AUDIT_RETENTION_MIN_DAYS, max: AUDIT_RETENTION_MAX_DAYS }
}
