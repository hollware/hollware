import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'

// Fails when: the migration that wrangler.jsonc points at stops creating _hollware_meta, or
// Playground.metaKeys() (src/index.ts) stops answering the keys of that table, or its
// `ORDER BY key DESC` is dropped or changed.

describe('D1 after the shipped migrations', () => {
  it('has the _hollware_meta table', async () => {
    const table = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_hollware_meta'",
    ).first<{ name: string }>()

    expect(table).toEqual({ name: '_hollware_meta' })
  })
})

describe('Playground.metaKeys() over RPC', () => {
  // Storage is isolated per test file, not per test: leave the table as the migration made it.
  afterEach(async () => {
    await env.DB.prepare('DELETE FROM _hollware_meta').run()
  })

  it('is empty on a fresh database', async () => {
    expect(await exports.Playground.metaKeys()).toEqual([])
  })

  it('lists the keys in descending order, whatever order they were written in', async () => {
    // Written out of order on purpose: not ascending, not descending, and the values sort in a
    // third order. So the order expected below can only come from sorting the keys descending.
    // With no ORDER BY, SQLite walks the primary-key index and answers ascending.
    const insert = env.DB.prepare('INSERT INTO _hollware_meta (key, value) VALUES (?, ?)')
    await env.DB.batch([
      insert.bind('created_at', '2026-10-12'),
      insert.bind('site_name', 'demo'),
      insert.bind('schema_version', '1'),
    ])

    expect(await exports.Playground.metaKeys()).toEqual([
      'site_name',
      'schema_version',
      'created_at',
    ])
  })
})
