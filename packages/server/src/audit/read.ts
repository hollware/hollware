import { isAuditAction } from '@hollware/core'
import type { D1Like } from '../db/d1.ts'

export interface ActivityFilters {
  readonly actor?: string
  readonly action?: string
  readonly targetType?: string
  readonly targetId?: string
  readonly from?: string
  readonly to?: string
}

export interface ActivityLine {
  readonly id: string
  readonly at: string
  readonly action: string
  readonly outcome: string
  readonly errorCode: string | null
  readonly actor: {
    readonly kind: string
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
  readonly lines: readonly ActivityLine[]
  readonly nextCursor: string | null
}

export class ActivityInputError extends Error {
  readonly fix: string
  constructor(message: string, fix: string) {
    super(message)
    this.fix = fix
  }
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
const ID = /^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/

function encodeCursor(at: string, id: string): string {
  return btoa(`${at}|${id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeCursor(cursor: string): { at: string; id: string } {
  try {
    const text = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'))
    const [at = '', id = ''] = text.split('|')
    if (INSTANT.test(at) && ID.test(id)) return { at, id }
  } catch {}
  throw new ActivityInputError(
    'The cursor is not valid for the activity log.',
    'Pass the nextCursor of the previous page unchanged, or leave it out for the first page.',
  )
}

function instant(name: string, value: string | undefined): string | null {
  if (value === undefined) return null
  if (!INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ActivityInputError(
      `${name} is not an instant.`,
      'Give it in UTC as 2026-10-17T00:00:00.000Z.',
    )
  }
  return new Date(value).toISOString()
}

function json(text: string | null): Readonly<Record<string, unknown>> | null {
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : null
  } catch {
    return null
  }
}

interface Row {
  id: string
  created_at: string
  action: string
  outcome: string
  error_code: string | null
  actor_kind: string
  actor_user_id: string | null
  actor_name: string | null
  actor_token_id: string | null
  token_label: string | null
  actor_client_id: string | null
  actor_meta: string | null
  target_type: string | null
  target_id: string | null
  detail: string | null
  request_id: string | null
  ip_hash: string | null
}

export async function readActivity(
  db: D1Like,
  site: string,
  filters: ActivityFilters,
  page: { readonly cursor?: string; readonly limit: number },
): Promise<ActivityPage> {
  if (filters.action !== undefined && !isAuditAction(filters.action)) {
    throw new ActivityInputError(
      `There is no action ${filters.action}.`,
      'Use an action of the activity log, such as publish or token.create.',
    )
  }
  const limit = Math.min(Math.max(Math.trunc(page.limit), 1), 500)
  const where: string[] = ['a.site_id = ?1']
  const binds: unknown[] = [site]
  const add = (clause: (index: number) => string, value: unknown) => {
    binds.push(value)
    where.push(clause(binds.length))
  }
  if (filters.actor !== undefined) add((i) => `a.actor_user_id = ?${i}`, filters.actor)
  if (filters.action !== undefined) add((i) => `a.action = ?${i}`, filters.action)
  if (filters.targetType !== undefined) add((i) => `a.target_type = ?${i}`, filters.targetType)
  if (filters.targetId !== undefined) add((i) => `a.target_id = ?${i}`, filters.targetId)
  const from = instant('from', filters.from)
  if (from !== null) add((i) => `a.created_at >= ?${i}`, from)
  const to = instant('to', filters.to)
  if (to !== null) add((i) => `a.created_at < ?${i}`, to)
  if (page.cursor !== undefined) {
    const after = decodeCursor(page.cursor)
    binds.push(after.at, after.id)
    where.push(`(a.created_at, a.id) < (?${binds.length - 1}, ?${binds.length})`)
  }
  binds.push(limit + 1)
  const [result] = await db.batch<Row>([
    db
      .prepare(
        `SELECT a.id, a.created_at, a.action, a.outcome, a.error_code, a.actor_kind, a.actor_user_id,
                u.name AS actor_name, a.actor_token_id, t.label AS token_label, a.actor_client_id,
                a.actor_meta, a.target_type, a.target_id, a.detail, a.request_id, a.ip_hash
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_user_id
         LEFT JOIN tokens t ON t.id = a.actor_token_id AND t.site_id = a.site_id
         WHERE ${where.join(' AND ')}
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT ?${binds.length}`,
      )
      .bind(...binds),
  ])
  const rows = result?.results ?? []
  const lines = rows.slice(0, limit).map((row): ActivityLine => ({
    id: row.id,
    at: row.created_at,
    action: row.action,
    outcome: row.outcome,
    errorCode: row.error_code,
    actor: {
      kind: row.actor_kind,
      userId: row.actor_user_id,
      name: row.actor_name,
      tokenId: row.actor_token_id,
      tokenLabel: row.token_label,
      clientId: row.actor_client_id,
      declared: json(row.actor_meta),
    },
    target:
      row.target_type === null || row.target_id === null
        ? null
        : { type: row.target_type, id: row.target_id },
    detail: json(row.detail),
    requestId: row.request_id,
    ipHash: row.ip_hash,
  }))
  const last = lines.at(-1)
  return {
    lines,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last.at, last.id) : null,
  }
}

export const ACTIVITY_CSV_COLUMNS = [
  'at',
  'action',
  'outcome',
  'error_code',
  'actor_kind',
  'actor_user_id',
  'actor_name',
  'actor_token_id',
  'actor_token_label',
  'actor_client_id',
  'actor_declared',
  'target_type',
  'target_id',
  'detail',
  'request_id',
  'ip_hash',
] as const

export function csvField(value: string | null): string {
  if (value === null) return ''
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function activityCsvRow(line: ActivityLine): string {
  const text = (value: Readonly<Record<string, unknown>> | null) =>
    value === null ? null : JSON.stringify(value)
  return [
    line.at,
    line.action,
    line.outcome,
    line.errorCode,
    line.actor.kind,
    line.actor.userId,
    line.actor.name,
    line.actor.tokenId,
    line.actor.tokenLabel,
    line.actor.clientId,
    text(line.actor.declared),
    line.target?.type ?? null,
    line.target?.id ?? null,
    text(line.detail),
    line.requestId,
    line.ipHash,
  ]
    .map(csvField)
    .join(',')
}
