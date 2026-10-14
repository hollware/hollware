import { generatePersonalToken, hashPersonalToken, newId } from '@hollware/core'

/**
 * Rows for the auth tests, written straight into D1 with SQL: the site, a user with a role, and a
 * personal token with the columns a test needs to control. It never goes through the code under
 * test, and it takes a site key from the test, so that every test has a site of its own.
 */

export interface SeedTokenOptions {
  /** The role of the token's user. Default `owner`. */
  readonly role?: 'owner' | 'editor' | 'author'
  /** The scopes the token carries. Default all four. */
  readonly scopes?: readonly string[]
  readonly expiresAt?: string | null
  readonly revokedAt?: string | null
  readonly lastUsedAt?: string | null
  /** What is stored under the hash of this string, instead of a real personal token. */
  readonly secret?: string
}

export interface SeededToken {
  readonly site: string
  readonly userId: string
  readonly tokenId: string
  /** The secret in clear, to present it. */
  readonly token: string
}

const CREATED = '2026-10-01T00:00:00.000Z'

/** A site key no other test uses. */
export function newSite(): string {
  return `site-${crypto.randomUUID()}`
}

/** Writes the site when it is missing, a new user, and a new token of that user in the site. */
export async function seedToken(
  db: D1Database,
  site: string,
  options: SeedTokenOptions = {},
): Promise<SeededToken> {
  const userId = newId('usr')
  const tokenId = newId('tok')
  const token = options.secret ?? generatePersonalToken()
  await db.batch([
    db
      .prepare('INSERT OR IGNORE INTO sites (id, created_at, updated_at) VALUES (?1, ?2, ?2)')
      .bind(site, CREATED),
    db
      .prepare(
        'INSERT INTO users (id, name, role, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)',
      )
      .bind(userId, 'Test user', options.role ?? 'owner', CREATED),
    db
      .prepare(
        `INSERT INTO tokens (id, site_id, user_id, label, hash, scopes, expires_at, revoked_at,
          last_used_at, created_at, updated_at)
          VALUES (?1, ?2, ?3, 'test', ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
      )
      .bind(
        tokenId,
        site,
        userId,
        await hashPersonalToken(token),
        JSON.stringify(
          options.scopes ?? ['content:read', 'content:write', 'content:publish', 'schema:admin'],
        ),
        options.expiresAt ?? null,
        options.revokedAt ?? null,
        options.lastUsedAt ?? null,
        CREATED,
      ),
  ])
  return { site, userId, tokenId, token }
}

/** The columns of a token the check writes, as the table holds them now. */
export async function readUse(
  db: D1Database,
  tokenId: string,
): Promise<{ last_used_at: string | null; updated_at: string } | null> {
  return await db
    .prepare('SELECT last_used_at, updated_at FROM tokens WHERE id = ?1')
    .bind(tokenId)
    .first<{ last_used_at: string | null; updated_at: string }>()
}
