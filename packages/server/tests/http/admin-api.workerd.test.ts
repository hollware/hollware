import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { connect } from '../../src/db/d1.ts'
import { createSession } from '../../src/identity/store.ts'
import { seedToken } from '../auth/support.ts'
import { boot, NOW, SITE_KEY, type Booted } from './support.ts'

// Fails when: the admin's own routes (src/http/admin-api.ts) stop being the admin's alone: a
// personal token, even an owner's with schema:admin, or an admin token without schema:admin,
// reaches them; a token they make gets scopes its maker does not have, is not shown once, does not
// work, or still works once revoked; the list shows a hash; an invitation is made for an owner, or
// stops giving a link to /setup that the list of people then counts as pending.

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** An access token of the admin's own client, for a person of the site with this role. */
async function adminToken(worker: Booted, role: 'owner' | 'editor' | 'author'): Promise<string> {
  const { userId } = await seedToken(env.DB, SITE_KEY, { role })
  const session = await createSession(connect(env.DB), {
    site: SITE_KEY,
    userId,
    now: new Date(NOW),
    hours: 12,
  })
  const admin = await (
    await worker.send('/admin/config.json')
  ).json<{
    clientId: string
    redirectUri: string
    resource: string
    scope: string
  }>()
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: admin.clientId,
    redirect_uri: admin.redirectUri,
    scope: admin.scope,
    state: 's',
    code_challenge: base64url(new Uint8Array(digest)),
    code_challenge_method: 'S256',
    resource: admin.resource,
  })
  const redirect = await worker.send(`/authorize?${query.toString()}`, {
    headers: { cookie: `hollware_session=${session.secret}` },
  })
  const code = new URL(redirect.headers.get('location') ?? '').searchParams.get('code') ?? ''
  const tokens = await worker.send('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: admin.redirectUri,
      client_id: admin.clientId,
      code_verifier: verifier,
      resource: admin.resource,
    }).toString(),
  })
  return (await tokens.json<{ access_token: string }>()).access_token
}

function call(worker: Booted, token: string, path: string, body?: unknown) {
  return worker.send(path, {
    method: body === undefined ? 'GET' : 'POST',
    token,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
}

describe("the admin's own routes", () => {
  it("refuse a personal token, even an owner's, and an admin token without schema:admin", async () => {
    const worker = boot()
    const owner = await seedToken(env.DB, SITE_KEY)
    const editor = await adminToken(worker, 'editor')

    const personal = await call(worker, owner.token, '/v1/admin/tokens')
    const scoped = await call(worker, editor, '/v1/admin/tokens')

    expect(personal.status).toBe(403)
    expect(await personal.json()).toMatchObject({ message: 'Only the admin may do this.' })
    expect(scoped.status).toBe(403)
    expect(scoped.headers.get('www-authenticate')).toContain('scope="schema:admin"')
  })

  it('make a token with the scopes its maker has, once in clear, and revoke it', async () => {
    const worker = boot()
    const owner = await adminToken(worker, 'owner')

    const made = await call(worker, owner, '/v1/admin/tokens', {
      label: 'Agent',
      scopes: ['content:read', 'content:publish', 'everything'],
    })
    const created = await made.json<{ id: string; secret: string; scopes: string[] }>()
    const listed = await (
      await call(worker, owner, '/v1/admin/tokens')
    ).json<{
      tokens: Record<string, unknown>[]
    }>()
    const before = await worker.send('/v1/site', { token: created.secret })
    await call(worker, owner, `/v1/admin/tokens/${created.id}/revoke`, {})
    const after = await worker.send('/v1/site', { token: created.secret })

    expect(made.status).toBe(201)
    expect(created.scopes).toEqual(['content:read', 'content:publish'])
    expect(created.secret).toMatch(/^hw_pat_/)
    const row = listed.tokens.find((token) => token['id'] === created.id)
    expect(row).toMatchObject({ label: 'Agent', scopes: ['content:read', 'content:publish'] })
    expect(row).not.toHaveProperty('hash')
    expect(JSON.stringify(listed)).not.toContain(created.secret)
    expect([before.status, after.status]).toEqual([200, 401])
  })

  it('invite an editor or an author with a link to /setup, and never an owner', async () => {
    const worker = boot()
    const owner = await adminToken(worker, 'owner')

    const invited = await call(worker, owner, '/v1/admin/invitations', { role: 'author' })
    const asOwner = await call(worker, owner, '/v1/admin/invitations', { role: 'owner' })
    const people = await (
      await call(worker, owner, '/v1/admin/people')
    ).json<{
      people: { role: string }[]
      invitations: { role: string }[]
    }>()

    expect(invited.status).toBe(201)
    expect(await invited.json()).toMatchObject({
      role: 'author',
      link: expect.stringMatching(/^https:\/\/hollware\.test\/setup\?invitation=hw_inv_/),
    })
    expect(asOwner.status).toBe(400)
    expect(people.invitations.map((invitation) => invitation.role)).toContain('author')
    expect(people.people.some((person) => person.role === 'owner')).toBe(true)
  })
})
