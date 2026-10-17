import {
  newId,
  type AuditAction,
  type AuditActorKind,
  type AuditOutcome,
  type ResolvedAudit,
} from '@hollware/core'
import type { Principal } from '../auth/types.ts'
import type { D1Like } from '../db/d1.ts'

/**
 * The activity log (ADR-037): who did what to a site, through what, and how it ended. A line is
 * written in the batch of the change it describes where a route makes the change itself, and on its
 * own after an operation, whose revision, publication or change of structure already names its
 * actor in its own batch. Writing a line on its own never fails the request: a line that cannot be
 * written is logged as `audit_write_failed`.
 */

/** Who acted, as Hollware verified it, and what the client said about itself. */
export interface AuditActor {
  readonly kind: AuditActorKind
  readonly userId: string | null
  readonly tokenId: string | null
  readonly clientId: string | null
  /** The client's own claim (its MCP client, its model): never what let it in. */
  readonly meta: Readonly<Record<string, unknown>> | null
}

/** One line, as a route or an operation describes it. */
export interface AuditLine {
  readonly action: AuditAction
  readonly outcome: AuditOutcome
  readonly errorCode?: string | null
  readonly target?: { readonly type: string; readonly id: string } | null
  /** A small object about the change: never a secret, a token or the content of an entry. */
  readonly detail?: Readonly<Record<string, unknown>> | null
}

/** The most characters of JSON a line keeps in `detail` and in `actor_meta`, as the table checks. */
export const AUDIT_JSON_MAX = 2000

/** JSON of at most `AUDIT_JSON_MAX` characters: a longer value says only that it was too long. */
export function boundedJson(value: Readonly<Record<string, unknown>> | null): string | null {
  if (value === null) return null
  const text = JSON.stringify(value)
  return text.length <= AUDIT_JSON_MAX ? text : JSON.stringify({ truncated: true })
}

/**
 * The actor of a principal. A person signed in to the admin is a `user`, with the admin as their
 * client; any other OAuth client is an `oauth_client`; a personal or read token is a `token`.
 */
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

/** A person, signed in with their passkey, on the pages of the Worker. */
export function personActor(userId: string): AuditActor {
  return { kind: 'user', userId, tokenId: null, clientId: null, meta: null }
}

/** The deployment itself, acting for the person who asked it to: its cron. */
export function systemActor(forUserId: string | null): AuditActor {
  return { kind: 'system', userId: forUserId, tokenId: null, clientId: null, meta: null }
}

/**
 * The key of a site that hashes addresses: HKDF-SHA256 of the Worker secret `HOLLWARE_SECRET`,
 * bound to the site, so one address hashes alike within a site and differently in another, and
 * no hash can be checked against the 2³² IPv4 addresses without the secret.
 */
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

/** The hex HMAC-SHA256 of an address under the key of its site. */
export async function hashAddress(master: string, site: string, address: string): Promise<string> {
  const mac = await crypto.subtle.sign(
    'HMAC',
    await addressKey(master, site),
    new TextEncoder().encode(address),
  )
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** What the log says when a line could not be written, or written whole. */
export type AuditLogEntry =
  | {
      readonly kind: 'audit_write_failed'
      readonly site: string
      readonly action: string
      readonly requestId: string | null
      readonly message: string
    }
  | {
      /** A site keeps addresses, but the Worker has no `HOLLWARE_SECRET` to key their hash. */
      readonly kind: 'audit_address_unkeyed'
      readonly site: string
      readonly requestId: string | null
    }

/** What a request knows when it writes lines: where they go and what each of them repeats. */
export interface AuditRequest {
  readonly db: D1Like
  readonly actor: AuditActor
  readonly requestId: string | null
  /** The address of the request (`cf-connecting-ip`), or `null` when there is none. */
  readonly address: string | null
  /** `HOLLWARE_SECRET`; without it a site that keeps addresses gets none, and it is logged. */
  readonly master: string | undefined
  readonly now: () => Date
  readonly log: (entry: AuditLogEntry) => void
}

export interface AuditLog {
  /** The statement that writes a line of a site, for the batch of the change it describes. */
  statement(site: AuditSite, line: AuditLine): Promise<D1PreparedStatement>
  /** Writes a line of a site on its own. It never throws: a failure is logged. */
  write(site: AuditSite, line: AuditLine): Promise<void>
}

/** A site as the log needs it: its key, and what its owner chose to keep. */
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

/** How many lines past their retention one run of the cron deletes, per site. */
export const EXPIRED_LINES_PER_RUN = 500

/**
 * Deletes the lines of a site older than its retention, a bounded number per run (ADR-037). A site
 * with no retention keeps every line. The trigger of migrations/0016 refuses any other delete.
 */
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
