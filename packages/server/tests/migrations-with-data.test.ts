import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vite-plus/test'

// Fails when: a migration that runs after content exists breaks on that content or loses it. The
// migrations up to 0003 run on an empty database, as they do for a new project; then a site, its
// owner, a token, an entry with its revision and a publication are written, as a deployment of
// v0.2 holds them; then every later migration runs, in order, as `hollware migrate` runs them. The
// rows must all still be there, every person with a token must be a member of its site with the
// role they had, a passkey and a session of v0.3 must outlive the loss of their site (0006), an
// event of the outbox and its delivery must outlive the rebuild of the outbox (0013), which then
// takes an event about no entry, and no foreign key may point nowhere. This is what caught a rebuild of `users` in
// the first 0004: with foreign keys on, as D1 always has them, dropping a table that other rows
// point at fails the transaction (D1 answered it as "internal error").

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations')

/** The statements of a migration, as D1 runs them: split where drizzle-kit marks the breaks. */
function statementsOf(file: string): string[] {
  return readFileSync(join(MIGRATIONS, file), 'utf8')
    .split('--> statement-breakpoint')
    .filter((statement) => statement.trim() !== '')
}

const T = '2026-10-01T10:00:00.000Z'
const ID = (prefix: string) => `${prefix}_01JAB3XQ8ZK4M6N2P5R7S9T0VW`

/** What a deployment of v0.2 holds: one of each row that later migrations must keep. */
const CONTENT = [
  `INSERT INTO sites (id, created_at, updated_at) VALUES ('demo', '${T}', '${T}')`,
  `INSERT INTO users (id, name, role, created_at, updated_at) VALUES ('${ID('usr')}', 'Owner', 'owner', '${T}', '${T}')`,
  `INSERT INTO tokens (id, site_id, user_id, label, hash, scopes, created_at, updated_at)
    VALUES ('${ID('tok')}', 'demo', '${ID('usr')}', 'cli', 'hash', '["content:read"]', '${T}', '${T}')`,
  // A reviewer, which v0.1 allowed and nothing made: an author since v0.3.
  `INSERT INTO users (id, name, role, created_at, updated_at) VALUES ('usr_reviewer', 'Rae', 'reviewer', '${T}', '${T}')`,
  `INSERT INTO tokens (id, site_id, user_id, label, hash, scopes, created_at, updated_at)
    VALUES ('tok_reviewer', 'demo', 'usr_reviewer', 'cli', 'hash-2', '["content:read"]', '${T}', '${T}')`,
  `INSERT INTO entries (id, site_id, collection, locale, slug, status, version, head_rev, created_at, updated_at)
    VALUES ('${ID('ent')}', 'demo', 'blog', 'en', 'hello', 'draft', 1, '${ID('rev')}', '${T}', '${T}')`,
  `INSERT INTO revisions (id, site_id, entry_id, markdown, frontmatter, document, comark_version,
    pipeline_version, word_count, verdict, actor_kind, actor_user_id, actor_token_id, created_at, updated_at)
    VALUES ('${ID('rev')}', 'demo', '${ID('ent')}', '# Hello', '{"title":"Hello harbour"}', '{}', '0.7.0', '1', 1, '{}',
    'token', '${ID('usr')}', '${ID('tok')}', '${T}', '${T}')`,
  `INSERT INTO publications (id, site_id, entry_id, revision_id, action, verdict, acknowledged,
    actor_kind, actor_user_id, actor_token_id, created_at, updated_at)
    VALUES ('${ID('pub')}', 'demo', '${ID('ent')}', '${ID('rev')}', 'publish', '{}', '[]',
    'token', '${ID('usr')}', '${ID('tok')}', '${T}', '${T}')`,
  // The event of that publication, delivered once: `deliveries` points at the outbox.
  `INSERT INTO outbox (id, site_id, kind, entry_id, payload, sent_at, created_at, updated_at)
    VALUES ('${ID('evt')}', 'demo', 'entry.published', '${ID('ent')}', '{"kind":"entry.published"}', '${T}', '${T}', '${T}')`,
  `INSERT INTO deliveries (id, site_id, event_id, subscriber, attempts, delivered_at, created_at, updated_at)
    VALUES ('${ID('dlv')}', 'demo', '${ID('evt')}', 'webhook:site', 1, '${T}', '${T}', '${T}')`,
]

/** The entry published, before the search index of 0008 exists, which it must then hold. */
const PUBLISHED = [
  `UPDATE entries SET status = 'published', published_rev = head_rev, published_at = '${T}',
    published_sort_key = '${T}', version = 2 WHERE id = '${ID('ent')}'`,
]

/** What v0.3 holds of the owner's sign-in: a passkey and a session, then of a site. */
const PEOPLE = [
  `INSERT INTO passkeys (id, site_id, user_id, credential_id, public_key, counter, transports, label, created_at, updated_at)
    VALUES ('pky_1', 'demo', '${ID('usr')}', 'credential-1', 'key', 0, '[]', 'Laptop', '${T}', '${T}')`,
  `INSERT INTO sessions (id, site_id, user_id, hash, expires_at, created_at, updated_at)
    VALUES ('ses_1', 'demo', '${ID('usr')}', 'session-hash', '2099-01-01T00:00:00.000Z', '${T}', '${T}')`,
]

it('runs every migration after 0003 over the content of a deployment, and keeps all of it', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  const files = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  const early = files.filter((file) => file < '0004')
  const later = files.filter((file) => file >= '0004')
  expect(early).toEqual([
    '0000_init.sql',
    '0001_core.sql',
    '0002_append_only.sql',
    '0003_events_and_schedules.sql',
  ])
  for (const file of early) for (const statement of statementsOf(file)) db.exec(statement)
  // An entry and its first revision point at each other: they land together, as a batch writes them.
  db.exec('BEGIN')
  db.exec('PRAGMA defer_foreign_keys = ON')
  for (const statement of CONTENT) db.exec(statement)
  db.exec('COMMIT')

  for (const file of later) {
    // A person with a passkey and a session, as the admin of v0.3 makes them, before they lose
    // their site.
    if (file.startsWith('0006')) for (const statement of PEOPLE) db.exec(statement)
    if (file.startsWith('0008')) for (const statement of PUBLISHED) db.exec(statement)
    db.exec('BEGIN')
    for (const statement of statementsOf(file)) db.exec(statement)
    db.exec('COMMIT')
  }

  const count = (table: string) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n']
  expect(['sites', 'users', 'tokens', 'entries', 'revisions', 'publications'].map(count)).toEqual([
    1, 2, 2, 1, 1, 1,
  ])
  expect(db.prepare('SELECT site_id, user_id, role FROM members ORDER BY user_id').all()).toEqual([
    { site_id: 'demo', user_id: ID('usr'), role: 'owner' },
    { site_id: 'demo', user_id: 'usr_reviewer', role: 'author' },
  ])
  expect(db.prepare('SELECT id FROM members').get()).toEqual({
    id: expect.stringMatching(/^mbr_[0-9A-F]{26}$/),
  })
  expect(db.prepare('SELECT user_id, credential_id FROM passkeys').all()).toEqual([
    { user_id: ID('usr'), credential_id: 'credential-1' },
  ])
  expect(db.prepare('SELECT user_id, hash FROM sessions').all()).toEqual([
    { user_id: ID('usr'), hash: 'session-hash' },
  ])
  // 0008 indexes what was published before it.
  expect(
    db.prepare("SELECT entry_id, title FROM entries_fts WHERE entries_fts MATCH 'harbour'").all(),
  ).toEqual([{ entry_id: ID('ent'), title: 'Hello harbour' }])
  // 0013 kept the event and its delivery, and takes a change of the site, about no entry.
  expect(db.prepare('SELECT id, kind, entry_id FROM outbox').all()).toEqual([
    { id: ID('evt'), kind: 'entry.published', entry_id: ID('ent') },
  ])
  expect(db.prepare('SELECT event_id, subscriber FROM deliveries').all()).toEqual([
    { event_id: ID('evt'), subscriber: 'webhook:site' },
  ])
  db.exec(`INSERT INTO outbox (id, site_id, kind, entry_id, payload, created_at, updated_at)
    VALUES ('evt_site', 'demo', 'site.changed', NULL, '{"kind":"site.changed"}', '${T}', '${T}')`)
  expect(() =>
    db.exec(`INSERT INTO outbox (id, site_id, kind, entry_id, payload, created_at, updated_at)
      VALUES ('evt_bad', 'demo', 'entry.published', NULL, '{}', '${T}', '${T}')`),
  ).toThrow(/CHECK constraint failed: outbox_entry/)
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})
