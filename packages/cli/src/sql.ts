import { isId, isScope, isSiteKey, SCOPES, SITE_KEY_MAX_LENGTH, type Scope } from '@hollware/core'
import { UsageError } from './errors.ts'
import { printable } from './format.ts'

/**
 * Everything the CLI says to the database. A value a person types is checked first and then
 * enters a statement only as a SQL string literal, `'` doubled, so it cannot become part of the
 * statement; the statements themselves are fixed templates. Nothing else in the package builds
 * SQL.
 */

/** A SQL string literal: the value in single quotes, with every single quote doubled. */
export function quote(value: string): string {
  if (value.includes('\u0000')) throw new TypeError('a SQL string cannot hold a NUL character')
  return `'${value.replaceAll("'", "''")}'`
}

/** A value a person typed, quoted and escaped for a message; invisible characters become `?`. */
function shown(value: string): string {
  return printable(JSON.stringify(value))
}

/** A site key: lowercase letters and digits joined by single hyphens, like a slug. */
export function parseSiteKey(value: string): string {
  if (!isSiteKey(value)) {
    throw new UsageError(
      `invalid --site ${shown(value)}: a site key is lowercase letters and digits joined by single hyphens, up to ${SITE_KEY_MAX_LENGTH} characters, such as "blog" or "my-site".`,
    )
  }
  return value
}

const LABEL_MAX = 64
const OWNER_NAME_MAX = 100
// Control characters (a newline, a tab, an escape sequence), invisible formatting characters
// (zero-width marks, the bidirectional overrides that make a terminal show text backwards),
// lone surrogates and the line and paragraph separators.
const FORBIDDEN_IN_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u

function parseText(value: string, flag: string, max: number): string {
  const text = value.trim()
  const length = Array.from(text).length
  if (length < 1 || length > max || FORBIDDEN_IN_TEXT.test(text)) {
    throw new UsageError(
      `invalid ${flag} ${shown(value)}: use 1 to ${max} characters, with no control or invisible formatting characters.`,
    )
  }
  return text
}

/** The label of a token: 1 to 64 characters, trimmed, with nothing that a terminal would act on. */
export function parseLabel(value: string): string {
  return parseText(value, '--label', LABEL_MAX)
}

/** The name of the owner: the same rules as a label, up to 100 characters. */
export function parseOwnerName(value: string): string {
  return parseText(value, '--owner-name', OWNER_NAME_MAX)
}

/** The scopes of `--scopes`: a comma-separated list of known scopes, without repeats. */
export function parseScopes(value: string): Scope[] {
  const names = value.split(',').map((name) => name.trim())
  const scopes: Scope[] = []
  for (const name of names) {
    if (!isScope(name)) {
      throw new UsageError(
        `invalid --scopes: ${shown(name)} is not a scope. Choose from ${SCOPES.join(', ')}.`,
      )
    }
    if (!scopes.includes(name)) scopes.push(name)
  }
  return scopes
}

/** The longest life a personal token may be given. A token that lasts longer is a bigger risk. */
export const MAX_EXPIRES_IN_DAYS = 365

/** The days of `--expires-in-days`: a whole number from 1 to 365. */
export function parseExpiresInDays(value: string): number {
  const days = /^[0-9]{1,4}$/.test(value) ? Number(value) : 0
  if (days < 1 || days > MAX_EXPIRES_IN_DAYS) {
    throw new UsageError(
      `invalid --expires-in-days ${shown(value)}: use a whole number of days from 1 to ${MAX_EXPIRES_IN_DAYS}.`,
    )
  }
  return days
}

/** The id of a token, `tok_` and 26 characters, as `token list` shows it. */
export function parseTokenId(value: string): string {
  if (!isId('tok', value)) {
    throw new UsageError(
      `invalid token id ${shown(value)}: a token id is tok_ followed by 26 characters. "hollware token list" shows them.`,
    )
  }
  return value
}

const DATABASE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

/** A D1 database, by name or by binding, as wrangler takes it. It never starts with a hyphen. */
export function parseDatabase(value: string): string {
  if (!DATABASE.test(value)) {
    throw new UsageError(
      `invalid --database ${shown(value)}: use the name or the binding of a D1 database (letters, digits, "_", "-" and ".", not starting with "-").`,
    )
  }
  return value
}

/** The statement that finds the owners: the members with the role owner, first come first (ADR-026). */
export function ownerQuery(): string {
  return "SELECT user_id AS id, site_id AS site FROM members WHERE role = 'owner' ORDER BY created_at, user_id"
}

/** One statement for the sites of the database and one for its first owner. */
export function sitesAndOwnerQuery(): string {
  return "SELECT id FROM sites ORDER BY id; SELECT user_id AS id FROM members WHERE role = 'owner' ORDER BY created_at, user_id LIMIT 1;"
}

/** The owner of a site: the member with the role owner who came first. */
export function ownerOfSiteQuery(site: string): string {
  return `SELECT user_id AS id FROM members WHERE site_id = ${quote(site)} AND role = 'owner' ORDER BY created_at, user_id LIMIT 1;`
}

/** The sites of the database. */
export function sitesQuery(): string {
  return 'SELECT id FROM sites ORDER BY id;'
}

export interface NewToken {
  id: string
  /** A read token (`hw_read_`); a personal token when absent, the column's default. */
  kind?: 'read'
  site: string
  userId: string
  label: string
  /** The SHA-256 of the token, in hex. */
  hash: string
  scopes: readonly Scope[]
  expiresAt: string
  now: string
}

/** The row of a new token. */
export function insertToken(token: NewToken): string {
  const kind = token.kind === undefined ? ['', ''] : [', kind', `, ${quote(token.kind)}`]
  return `INSERT INTO tokens (id, site_id, user_id, label, hash, scopes, expires_at, created_at, updated_at${kind[0]}) VALUES (${quote(token.id)}, ${quote(token.site)}, ${quote(token.userId)}, ${quote(token.label)}, ${quote(token.hash)}, ${quote(JSON.stringify(token.scopes))}, ${quote(token.expiresAt)}, ${quote(token.now)}, ${quote(token.now)}${kind[1]});`
}

export interface FirstSite {
  site: string
  ownerId: string
  /** The id of the owner's row of `members`. */
  memberId: string
  ownerName: string | undefined
  token: NewToken
}

/**
 * What `init` writes, in one script: the site (left alone if it is already there), its owner, a
 * member of the site with the role owner, and the owner's first token. `users.role` gets the
 * owner too, the one name of a role that its CHECK and `members` share.
 */
export function initScript({ site, ownerId, memberId, ownerName, token }: FirstSite): string {
  const name = ownerName === undefined ? 'NULL' : quote(ownerName)
  return [
    `INSERT INTO sites (id, created_at, updated_at) VALUES (${quote(site)}, ${quote(token.now)}, ${quote(token.now)}) ON CONFLICT (id) DO NOTHING;`,
    `INSERT INTO users (id, name, role, created_at, updated_at) VALUES (${quote(ownerId)}, ${name}, 'owner', ${quote(token.now)}, ${quote(token.now)});`,
    `INSERT INTO members (id, site_id, user_id, role, created_at, updated_at) VALUES (${quote(memberId)}, ${quote(site)}, ${quote(ownerId)}, 'owner', ${quote(token.now)}, ${quote(token.now)});`,
    insertToken(token),
    '',
  ].join('\n')
}

export interface AnotherSite {
  site: string
  ownerId: string
  memberId: string
  token: NewToken
}

/**
 * What `init` writes for a site of a deployment that has an owner already: the site, the owner as
 * its owner too (one person across the sites of a deployment), and a token of that site.
 */
export function anotherSiteScript({ site, ownerId, memberId, token }: AnotherSite): string {
  return [
    `INSERT INTO sites (id, created_at, updated_at) VALUES (${quote(site)}, ${quote(token.now)}, ${quote(token.now)}) ON CONFLICT (id) DO NOTHING;`,
    `INSERT INTO members (id, site_id, user_id, role, created_at, updated_at) VALUES (${quote(memberId)}, ${quote(site)}, ${quote(ownerId)}, 'owner', ${quote(token.now)}, ${quote(token.now)});`,
    insertToken(token),
    '',
  ].join('\n')
}

export interface NewInvitation {
  id: string
  site: string
  hash: string
  role: 'owner' | 'editor' | 'author'
  /** The person the link is for, or null for an invitation that makes a new one. */
  userId: string | null
  expiresAt: string
  now: string
}

/** The row of an invitation (ADR-026): the owner's setup link, or an invitation with a role. */
export function insertInvitation(invitation: NewInvitation): string {
  const user = invitation.userId === null ? 'NULL' : quote(invitation.userId)
  return `INSERT INTO invitations (id, site_id, hash, role, user_id, expires_at, used_at, created_at, updated_at) VALUES (${quote(invitation.id)}, ${quote(invitation.site)}, ${quote(invitation.hash)}, ${quote(invitation.role)}, ${user}, ${quote(invitation.expiresAt)}, NULL, ${quote(invitation.now)}, ${quote(invitation.now)});`
}

/** The tokens of a site. It never selects the hash. */
export function listTokens(site: string): string {
  return `SELECT id, label, scopes, expires_at, revoked_at, last_used_at, created_at FROM tokens WHERE site_id = ${quote(site)} ORDER BY created_at, id;`
}

/**
 * Revokes a token that is not revoked yet and tells what is stored for the id afterwards: the
 * first statement returns the id when it revoked the token, the second the row, if there is one.
 */
export function revokeToken(id: string, site: string | undefined, now: string): string {
  const scope = site === undefined ? '' : ` AND site_id = ${quote(site)}`
  return `UPDATE tokens SET revoked_at = ${quote(now)}, updated_at = ${quote(now)} WHERE id = ${quote(id)}${scope} AND revoked_at IS NULL RETURNING id; SELECT id, revoked_at FROM tokens WHERE id = ${quote(id)}${scope};`
}
