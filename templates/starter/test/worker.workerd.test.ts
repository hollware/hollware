import { sitePreset } from '@hollware/core'
import type { HollwareRpc } from '@hollware/server'
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import worker from '../src/worker.ts'

const PUBLIC_HOST = 'localhost:5199'
const asHost = (host: string) => ({ headers: { host } })

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
  it('has every migration of @hollware/server applied, and its tables', async () => {
    const { results: applied } = await env.DB.prepare(
      'SELECT name FROM d1_migrations ORDER BY id',
    ).all<{ name: string }>()
    const { results: tables } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all<{ name: string }>()

    expect(env.TEST_MIGRATIONS.length).toBeGreaterThan(0)
    expect(applied.map((row) => row.name)).toEqual(
      env.TEST_MIGRATIONS.map((migration) => migration.name),
    )
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining(['sites', 'entries', 'revisions', 'publications', 'users', 'tokens']),
    )
  })
})
