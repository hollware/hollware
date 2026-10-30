import { generateAgentGrant, hashPersonalToken, newId } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'

import { adminPerson, call } from './admin-session.ts'
import { boot, NOW, SITE_KEY } from './support.ts'

vi.setConfig({ testTimeout: 60_000 })

describe('the agents of a site, from the admin', () => {
  it('makes an agent member, lists it apart from people, refuses its name twice and removes it with its grants', async () => {
    const worker = boot()
    const owner = await adminPerson(worker, 'owner')
    const name = `reviewer-${crypto.randomUUID().slice(0, 8)}`

    const made = await call(worker, owner.access, '/v1/admin/agents', { name })
    const created = await made.json<{ id: string; name: string }>()
    const again = await call(worker, owner.access, '/v1/admin/agents', { name })
    const listed = await (
      await call(worker, owner.access, '/v1/admin/agents')
    ).json<{
      agents: { id: string; name: string }[]
    }>()
    const people = await (
      await call(worker, owner.access, '/v1/admin/people')
    ).json<{
      people: { id: string; kind: string; role: string }[]
    }>()
    await env.DB.prepare(
      `INSERT INTO agent_grants (id, site_id, user_id, agent, hash, scopes, expires_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, 'reviewer', ?4, '[]', '2026-10-13T13:00:00.000Z', ?5, ?5)`,
    )
      .bind(newId('agt'), SITE_KEY, created.id, await hashPersonalToken(generateAgentGrant()), NOW)
      .run()
    const person = await worker.send(`/v1/admin/agents/${owner.userId}`, {
      method: 'DELETE',
      token: owner.access,
    })
    const removed = await worker.send(`/v1/admin/agents/${created.id}`, {
      method: 'DELETE',
      token: owner.access,
    })
    const grants = await env.DB.prepare('SELECT revoked_at FROM agent_grants WHERE user_id = ?1')
      .bind(created.id)
      .all<{ revoked_at: string | null }>()
    const member = await env.DB.prepare(
      'SELECT 1 AS found FROM members WHERE site_id = ?1 AND user_id = ?2',
    )
      .bind(SITE_KEY, created.id)
      .first()

    expect([made.status, created.name]).toEqual([201, name])
    expect(again.status).toBe(409)
    expect(listed.agents.filter((agent) => agent.id === created.id)).toEqual([
      { id: created.id, name, since: NOW },
    ])
    expect(
      people.people
        .filter((one) => one.id === created.id || one.id === owner.userId)
        .map(({ kind, role }) => [kind, role]),
    ).toEqual([
      ['person', 'owner'],
      ['agent', 'author'],
    ])
    expect([person.status, removed.status, await removed.json()]).toEqual([
      404,
      200,
      { outcome: 'removed' },
    ])
    expect(grants.results).toEqual([{ revoked_at: NOW }])
    expect(member).toBeNull()
  })

  it('refuses a name that is not lowercase words joined by hyphens', async () => {
    const worker = boot()
    const owner = await adminPerson(worker, 'owner')

    const answer = await call(worker, owner.access, '/v1/admin/agents', { name: 'Robot One' })

    expect(answer.status).toBe(400)
  })
})
