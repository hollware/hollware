import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'

// Fails when: the D1 binding of wrangler.jsonc stops pointing `migrations_dir` at the migrations
// that @hollware/server ships (node_modules/@hollware/server/migrations), so that the database the
// playground gets is not the one Hollware's store expects; or a shipped migration stops creating,
// or starts creating, one of these tables. The list is the schema of v0.1.

it('has the tables of the @hollware/server migrations, and no others', async () => {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
        AND name NOT IN ('d1_migrations', 'sqlite_sequence')
      ORDER BY name`,
  ).all<{ name: string }>()

  expect(results.map((row) => row.name)).toEqual([
    '_hollware_meta',
    'assets',
    'audit_log',
    'auth_challenges',
    'deliveries',
    'entries',
    // The full-text index (migrations/0008_search.sql) and the tables FTS5 keeps for it.
    'entries_fts',
    'entries_fts_config',
    'entries_fts_content',
    'entries_fts_data',
    'entries_fts_docsize',
    'entries_fts_idx',
    'entry_embeddings',
    'invitations',
    'members',
    'outbox',
    'passkeys',
    'publications',
    'redirects',
    'review_comments',
    'reviews',
    'revision_tags',
    'revisions',
    'schedules',
    'sessions',
    'site_changes',
    'site_secrets',
    'sites',
    'tokens',
    'unpublishes',
    'users',
  ])
})
