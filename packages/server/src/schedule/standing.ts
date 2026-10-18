import type { Scope } from '@hollware/core'
import { effectiveScopes } from '../auth/roles.ts'
import { hasExpired, parseTokenScopes } from '../auth/token.ts'
import type { Actor } from '../ports.ts'

/**
 * What the one who scheduled a publication may do now, when its time comes (T-108 of
 * docs/security/threat-model.md). A token is read again, and an OAuth client's grant: revoked,
 * expired, gone, or of a person who is no longer a member of the site, they may do nothing; else
 * what they carry intersected with the person's current role, as on every request (ADR-019). A
 * schedule never publishes with more than its author could publish at that moment.
 */
export async function scopesNow(
  bindings: { readonly db: D1Database; readonly kv: KVNamespace | undefined },
  actor: Actor,
  site: string,
  now: Date,
): Promise<readonly Scope[]> {
  const member = await bindings.db
    .prepare('SELECT role FROM members WHERE user_id = ?1 AND site_id = ?2')
    .bind(actor.userId, site)
    .first<{ role: string }>()
  if (member === null) return []
  if (actor.kind === 'oauth_client') {
    const client = actor.meta?.['oauthClient']
    if (typeof client !== 'string' || bindings.kv === undefined) return []
    return effectiveScopes(member.role, await grantScopes(bindings.kv, actor.userId, client, site))
  }
  if (actor.tokenId === null) return []
  const token = await bindings.db
    .prepare(
      'SELECT scopes, expires_at, revoked_at FROM tokens WHERE id = ?1 AND site_id = ?2 AND user_id = ?3',
    )
    .bind(actor.tokenId, site, actor.userId)
    .first<{ scopes: string; expires_at: string | null; revoked_at: string | null }>()
  if (token === null || token.revoked_at !== null || hasExpired(token.expires_at, now)) return []
  return effectiveScopes(member.role, parseTokenScopes(token.scopes))
}

/**
 * The scopes of the grants the person gave the client for the site, as the OAuth library keeps
 * them in KV (`grant:<userId>:<grantId>`); none when every grant of it was revoked.
 */
async function grantScopes(
  kv: KVNamespace,
  userId: string,
  clientId: string,
  site: string,
): Promise<Scope[]> {
  const prefix = `grant:${userId}:`
  const scopes = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await kv.list({ prefix, ...(cursor === undefined ? {} : { cursor }) })
    for (const key of page.keys) {
      // The library keeps the tokens of a grant under its key, one segment further.
      if (key.name.slice(prefix.length).includes(':')) continue
      const grant = await kv.get<{ clientId?: unknown; scope?: unknown; metadata?: unknown }>(
        key.name,
        'json',
      )
      if (grant === null || grant.clientId !== clientId) continue
      const metadata = grant.metadata
      const grantSite =
        typeof metadata === 'object' && metadata !== null ? Reflect.get(metadata, 'site') : null
      if (grantSite !== site) continue
      if (Array.isArray(grant.scope)) {
        for (const scope of grant.scope) if (typeof scope === 'string') scopes.add(scope)
      }
    }
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor !== undefined)
  return parseTokenScopes(JSON.stringify([...scopes]))
}
