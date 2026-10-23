import {
  newId,
  type AuditAction,
  type AuditActorKind,
  type AuditOutcome,
  type ResolvedAudit,
} from '@hollware/core'
import type { Principal } from '../auth/types.ts'
import type { D1Like } from '../db/d1.ts'

export interface AuditActor {
  readonly kind: AuditActorKind
  readonly userId: string | null
  readonly tokenId: string | null
  readonly clientId: string | null
  readonly meta: Readonly<Record<string, unknown>> | null
}

export interface AuditLine {
  readonly action: AuditAction
  readonly outcome: AuditOutcome
  readonly errorCode?: string | null
  readonly target?: { readonly type: string; readonly id: string } | null
  readonly detail?: Readonly<Record<string, unknown>> | null
}

export const AUDIT_JSON_MAX = 2000

export function boundedJson(value: Readonly<Record<string, unknown>> | null): string | null {
  if (value === null) return null
  const text = JSON.stringify(value)
  return text.length <= AUDIT_JSON_MAX ? text : JSON.stringify({ truncated: true })
}

export function actorOf(
  principal: Exclude<Principal, { readonly kind: 'binding' }>,
  meta: Readonly<Record<string, unknown>> | null,
  adminClientId: string | null,
): AuditActor {
  if (principal.kind === 'oauth') {
    return {
      kind: principal.clientId === adminClientId ? 'user' : 'oauth_client',
      userId: principal.userId,
      tokenId: null,
      clientId: principal.clientId,
      meta,
    }
  }
  return {
    kind: 'token',
    userId: principal.userId,
    tokenId: principal.tokenId,
    clientId: null,
    meta,
  }
}

export function personActor(userId: string): AuditActor {
  return { kind: 'user', userId, tokenId: null, clientId: null, meta: null }
}

export function systemActor(forUserId: string | null): AuditActor {
  return { kind: 'system', userId: forUserId, tokenId: null, clientId: null, meta: null }
}

async function addressKey(master: string, site: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(master),
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(`hollware audit address\n${site}`),
    },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  )
}

export async function hashAddress(master: string, site: string, address: string): Promise<string> {
  const mac = await crypto.subtle.sign(
    'HMAC',
    await addressKey(master, site),
    new TextEncoder().encode(address),
  )
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export type AuditLogEntry =
  | {
      readonly kind: 'audit_write_failed'
      readonly site: string
      readonly action: string
      readonly requestId: string | null
      readonly message: string
    }
  | {
      readonly kind: 'audit_address_unkeyed'
      readonly site: string
      readonly requestId: string | null
    }

export interface AuditRequest {
  readonly db: D1Like
  readonly actor: AuditActor
  readonly requestId: string | null
  readonly address: string | null
  readonly master: string | undefined
  readonly now: () => Date
  readonly log: (entry: AuditLogEntry) => void
}

export interface AuditLog {
  statement(site: AuditSite, line: AuditLine): Promise<D1PreparedStatement>
  write(site: AuditSite, line: AuditLine): Promise<void>
}

export interface AuditSite {
  readonly key: string
  readonly audit: ResolvedAudit
}

export function createAuditLog(request: AuditRequest): AuditLog {
  const addressOf = async (site: AuditSite): Promise<string | null> => {
    if (site.audit.ipAddresses !== 'hashed' || request.address === null) return null
    if (request.master === undefined || request.master.length < 32) {
      request.log({ kind: 'audit_address_unkeyed', site: site.key, requestId: request.requestId })
      return null
    }
    return hashAddress(request.master, site.key, request.address)
  }

  const statement = async (site: AuditSite, line: AuditLine): Promise<D1PreparedStatement> => {
    const at = request.now().toISOString()
    const { actor } = request
    return request.db
      .prepare(
        `INSERT INTO audit_log (id, site_id, action, outcome, error_code, actor_kind, actor_user_id, actor_token_id, actor_client_id, actor_meta, target_type, target_id, detail, request_id, ip_hash, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)`,
      )
      .bind(
        newId('aud'),
        site.key,
        line.action,
        line.outcome,
        line.errorCode ?? null,
        actor.kind,
        actor.userId,
        actor.tokenId,
        actor.clientId,
        boundedJson(actor.meta),
        line.target?.type ?? null,
        line.target?.id ?? null,
        boundedJson(line.detail ?? null),
        request.requestId,
        await addressOf(site),
        at,
      )
  }

  return {
    statement,
    async write(site, line) {
      try {
        await request.db.batch([await statement(site, line)])
      } catch (error) {
        request.log({
          kind: 'audit_write_failed',
          site: site.key,
          action: line.action,
          requestId: request.requestId,
          message: String(error),
        })
      }
    },
  }
}

export const EXPIRED_LINES_PER_RUN = 500

export async function dropExpiredLines(db: D1Like, site: AuditSite, now: Date): Promise<number> {
  const days = site.audit.retentionDays
  if (days === null) return 0
  const before = new Date(now.getTime() - days * 86_400_000).toISOString()
  const [result] = await db.batch([
    db
      .prepare(
        `DELETE FROM audit_log WHERE id IN (SELECT id FROM audit_log WHERE site_id = ?1 AND created_at < ?2 ORDER BY created_at LIMIT ?3)`,
      )
      .bind(site.key, before, EXPIRED_LINES_PER_RUN),
  ])
  return result?.meta.changes ?? 0
}
