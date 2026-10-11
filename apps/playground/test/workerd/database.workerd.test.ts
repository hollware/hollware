import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'

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

  it('lists the keys in alphabetical order', async () => {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO _hollware_meta (key, value) VALUES (?, ?)').bind('schema', '1'),
      env.DB.prepare('INSERT INTO _hollware_meta (key, value) VALUES (?, ?)').bind(
        'created_at',
        'x',
      ),
    ])

    expect(await exports.Playground.metaKeys()).toEqual(['created_at', 'schema'])
  })
})
