import { sitePreset } from '@hollware/core'
import type { HollwareRpc } from '@hollware/server'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import worker from '../src/worker.ts'

// Fails when: src/worker.ts stops exporting `{ fetch: hollware.fetch }` of createHollware()
// as the Worker, so that GET /health for the public URL of wrangler.jsonc (localhost:5199) stops
// answering 200, or another Host stops being a 403; when it stops exporting the class `Hollware`
// that sites read over a service binding, or stops serving the sites of the database (ADR-033:
// describeSite must answer the site that `hollware init` makes); or when the D1 binding of wrangler.jsonc stops
// pointing `migrations_dir` at the migrations of @hollware/server, so that its tables are missing.

// A request made inside workerd has no Host header of its own: a browser or curl would send one.
const PUBLIC_HOST = 'localhost:5199'
const asHost = (host: string) => ({ headers: { host } })

// Cloudflare's `Service<...>` types every answer that holds `unknown` as `never`, so the stub is
// read through the interface it implements.
const rpc: HollwareRpc = exports.Hollware

describe('the module', () => {
  it('exports the fetch, queue and scheduled handlers of Hollware', () => {
    expect(Object.keys(worker).sort()).toEqual(['fetch', 'queue', 'scheduled'])
  })
})

describe('the Worker over HTTP', () => {
  it('answers GET /health at its public URL', async () => {
    const response = await exports.default.fetch(
      `http://${PUBLIC_HOST}/health`,
      asHost(PUBLIC_HOST),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"ok":true}')
  })

  it('refuses a request for another Host with 403', async () => {
    const response = await exports.default.fetch('http://example.com/health', asHost('example.com'))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'forbidden_host' })
  })
})

describe('the Hollware class', () => {
  it('serves the site of the database over RPC, as hollware init makes it', async () => {
    const definition = sitePreset('blog', ['en', 'es'], 'en')
    await env.DB.prepare(
      "INSERT INTO sites (id, definition, version, created_at, updated_at) VALUES ('my-site', ?1, 1, 'now', 'now')",
    )
      .bind(JSON.stringify(definition))
      .run()

    const answer = await rpc.describeSite('my-site')

    expect(answer).toMatchObject({
      outcome: 'ok',
      site: {
        key: 'my-site',
        locales: ['en', 'es'],
        defaultLocale: 'en',
        collections: [{ name: 'blog', routes: { en: '/blog/:slug/', es: '/es/blog/:slug/' } }],
      },
    })
  })
})

describe('the database', () => {
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
      'review_comments',
      'reviews',
      'revision_tags',
      'revisions',
      'schedules',
      'sessions',
      'site_changes',
      'sites',
      'tokens',
      'users',
    ])
  })
})
