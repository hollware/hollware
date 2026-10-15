import { env } from 'cloudflare:workers'
import { expect, it } from 'vitest'

import { ROLE_SCOPES, ROLES } from '../../src/auth/roles.ts'

// Fails when: the `members_role` CHECK of the schema (src/db/schema.ts, migrations/) allows a role
// that ROLES and ROLE_SCOPES (src/auth/roles.ts) do not list, or the other way round, so that a
// role added to the database would get its scopes by accident instead of by a decision.

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
