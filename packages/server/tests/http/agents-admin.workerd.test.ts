import { generateAgentGrant, hashPersonalToken, newId } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'

import { handlers } from '../../src/ops/index.ts'
import { adminPerson, call } from './admin-session.ts'
import { boot, NOW, SITE_KEY } from './support.ts'

vi.setConfig({ testTimeout: 60_000 })

describe('the agents of a site, from the admin', () => {
  it('makes an agent member, lists it apart from people, refuses its name twice and removes it with its grants and tokens', async () => {
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
    const token = await (
      await call(worker, owner.access, '/v1/admin/tokens', {
        label: 'Gateway',
        scopes: ['content:read'],
        member: created.id,
      })
    ).json<{ id: string; secret: string }>()
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
    const revoked = await env.DB.prepare('SELECT revoked_at FROM tokens WHERE id = ?1')
      .bind(token.id)
      .first<string>('revoked_at')

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
    expect(revoked).toBe(NOW)
    expect(member).toBeNull()
  })

  it("gives an agent member a token of an author's scopes at most, of the expiry asked, that writes as the agent and asks for review instead of publishing", async () => {
    const worker = boot({ handlers })
    const owner = await adminPerson(worker, 'owner')
    const agent = await (
      await call(worker, owner.access, '/v1/admin/agents', {
        name: `gateway-${crypto.randomUUID().slice(0, 8)}`,
      })
    ).json<{ id: string }>()
    const ask = (body: Record<string, unknown>) =>
      call(worker, owner.access, '/v1/admin/tokens', { label: 'Executor', ...body })

    const made = await ask({
      scopes: ['content:read', 'content:write'],
      member: agent.id,
      expiresAt: '2027-06-30T00:00:00Z',
    })
    const token = await made.json<{ secret: string; userId: string; expiresAt: string }>()
    const listed = await (
      await call(worker, owner.access, '/v1/admin/tokens')
    ).json<{ tokens: { userId: string; userKind: string }[] }>()
    const forever = await (
      await ask({ scopes: ['content:read'], member: agent.id, expiresInDays: null })
    ).json<{ expiresAt: string | null }>()
    const publishing = await ask({ scopes: ['content:read', 'content:publish'], member: agent.id })
    const person = await ask({ scopes: ['content:read'], member: owner.userId })
    const reading = await ask({ kind: 'read', member: agent.id })
    const past = await ask({ scopes: ['content:read'], expiresAt: '2026-01-01T00:00:00Z' })
    const both = await ask({
      scopes: ['content:read'],
      expiresAt: '2027-06-30T00:00:00Z',
      expiresInDays: 30,
    })
    const draft = await worker.send('/v1/ops/create_draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        collection: 'blog',
        locale: 'en',
        slug: `from-the-gateway-${crypto.randomUUID().slice(0, 8)}`,
        markdown: '---\ntitle: From the gateway\n---\n\nWritten by an agent.\n',
      }),
      token: token.secret,
    })
    const saved = await draft.json<{ entry: { id: string; version: number } }>()
    const published = await worker.send('/v1/ops/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: saved.entry.id, version: saved.entry.version }),
      token: token.secret,
    })
    const author = await env.DB.prepare('SELECT actor_user_id FROM revisions WHERE entry_id = ?1')
      .bind(saved.entry.id)
      .first<string>('actor_user_id')

    expect([made.status, token.userId, token.expiresAt]).toEqual([
      201,
      agent.id,
      '2027-06-30T00:00:00.000Z',
    ])
    expect(listed.tokens.filter((one) => one.userId === agent.id)).toMatchObject([
      { userKind: 'agent' },
    ])
    expect(forever.expiresAt).toBeNull()
    expect([publishing.status, await publishing.json()]).toEqual([
      403,
      {
        code: 'forbidden',
        message: "An agent's token never holds content:publish.",
        fix: 'Choose among content:read, content:write, review:read, review:comment: an agent writes drafts and asks for review, and a person publishes.',
      },
    ])
    expect([person.status, reading.status, past.status, both.status]).toEqual([404, 400, 400, 400])
    expect(draft.status).toBe(200)
    expect(author).toBe(agent.id)
    expect(await published.json()).toMatchObject({ outcome: 'pending_review' })
  })

  it('refuses a name that is not lowercase words joined by hyphens', async () => {
    const worker = boot()
    const owner = await adminPerson(worker, 'owner')

    const answer = await call(worker, owner.access, '/v1/admin/agents', { name: 'Robot One' })

    expect(answer.status).toBe(400)
  })
})
