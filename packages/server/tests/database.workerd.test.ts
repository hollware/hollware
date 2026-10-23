import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'

it('runs on a D1 database with the migrations of the package applied', async () => {
  const table = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_hollware_meta'",
  ).first<{ name: string }>()
  expect(table).toEqual({ name: '_hollware_meta' })
})
