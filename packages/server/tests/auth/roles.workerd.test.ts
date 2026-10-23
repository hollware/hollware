import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'

import { ROLE_SCOPES, ROLES } from '../../src/auth/roles.ts'

it('lists every role the members table allows, and no other', async () => {
  const table = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'members'",
  ).first<{ sql: string }>()
  const list = /"members_role" CHECK\("members"\."role" IN \(([^)]*)\)\)/.exec(
    table?.sql ?? '',
  )?.[1]
  const allowed = (list ?? '').split(',').map((role) => role.trim().replaceAll("'", ''))

  expect([...allowed].sort()).toEqual(['author', 'editor', 'owner'])
  expect([...ROLES].sort()).toEqual(['author', 'editor', 'owner'])
  expect(Object.keys(ROLE_SCOPES).sort()).toEqual(['author', 'editor', 'owner'])
})
