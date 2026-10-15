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
    'auth_challenges',
    'deliveries',
    'entries',
    'invitations',
    'members',
    'outbox',
    'passkeys',
    'publications',
    'reviews',
    'revision_tags',
    'revisions',
    'schedules',
    'sessions',
    'sites',
    'tokens',
    'users',
  ])
})
