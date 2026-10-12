import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'

// Fails when: the test configuration loses its D1 binding, or the setup file stops applying the
// package's migrations, so that the tables of migrations/ are missing from the test database.

it('runs on a D1 database with the migrations of the package applied', async () => {
  const table = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_hollware_meta'",
  ).first<{ name: string }>()
  expect(table).toEqual({ name: '_hollware_meta' })
})
