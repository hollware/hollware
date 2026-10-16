import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { connect } from '../../src/db/d1.ts'
import { createSession } from '../../src/identity/store.ts'
import { seedToken } from '../auth/support.ts'
import { boot, NOW, OTHER_SITE_KEY, SITE_KEY, type Booted } from './support.ts'

// Fails when: the admin's own routes (src/http/admin-api.ts) stop being the admin's alone: a
// personal token, even an owner's with schema:admin, or an admin token without schema:admin,
// reaches them; a token they make gets scopes its maker does not have, is not shown once, does not
// work, or still works once revoked; the list shows a hash; an invitation is made for an owner, or
// stops giving a link to /setup that the list of people then counts as pending; or a read token
// made there stops being an hw_read_ token with content:read alone; or an owner stops being able
// to give a member another role or remove them, at once for their tokens, or can demote or remove
// the last owner of the site; or /v1/admin/me stops listing the trashed sites the person owns, and
// only those.

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * An access token of the admin's own client, for a person of the site with this role, who is an
 * editor of each site of `alsoEditorOf` too.
 */
async function adminToken(
  worker: Booted,
  role: 'owner' | 'editor' | 'author',
  alsoEditorOf: readonly string[] = [],
): Promise<string> {
  return (await adminPerson(worker, role, alsoEditorOf)).access
}

/** The same, with the person's id and their personal token. */
async function adminPerson(
  worker: Booted,
  role: 'owner' | 'editor' | 'author',
  alsoEditorOf: readonly string[] = [],
): Promise<{ access: string; userId: string; token: string }> {
  const { userId, token } = await seedToken(env.DB, SITE_KEY, { role })
  for (const site of alsoEditorOf) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO sites (id, created_at, updated_at) VALUES (?1, ?2, ?2)',
    )
      .bind(site, NOW)
      .run()
    await env.DB.prepare(
      "INSERT INTO members (id, site_id, user_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, 'editor', ?4, ?4)",
    )
      .bind(`mem_${crypto.randomUUID()}`, site, userId, NOW)
      .run()
  }
  const session = await createSession(connect(env.DB), {
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
  return { access: (await tokens.json<{ access_token: string }>()).access_token, userId, token }
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

  it('say who is signed in to any role, with the sites of this deployment they may switch to', async () => {
    const worker = boot()
    // A member of a site this deployment does not serve, too: the admin cannot switch to it.
    const author = await adminToken(worker, 'author', [OTHER_SITE_KEY])

    const me = await call(worker, author, '/v1/admin/me')
    const tokens = await call(worker, author, '/v1/admin/tokens')

    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({
      site: SITE_KEY,
      scopes: ['content:read', 'content:write'],
      sites: [{ site: SITE_KEY, role: 'author' }],
    })
    expect(tokens.status).toBe(403)
  })

  it('list the sites in the trash that the person owns, and no other', async () => {
    const worker = boot()
    const owner = await adminPerson(worker, 'owner')
    const [mine, theirs] = [
      `trashed-${crypto.randomUUID().slice(0, 6)}`,
      `kept-${crypto.randomUUID().slice(0, 6)}`,
    ]
    for (const [site, role] of [
      [mine, 'owner'],
      [theirs, 'editor'],
    ] as const) {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO sites (id, definition, version, deleted_at, created_at, updated_at) VALUES (?1, '{}', 2, ?2, ?2, ?2)",
        ).bind(site, NOW),
        env.DB.prepare(
          'INSERT INTO members (id, site_id, user_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)',
        ).bind(`mbr_${crypto.randomUUID()}`, site, owner.userId, role, NOW),
      ])
    }

    const me = await (await call(worker, owner.access, '/v1/admin/me')).json<{ trash: unknown[] }>()

    expect(me.trash).toEqual([{ site: mine, deletedAt: NOW }])
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

  it('make a read token that reads and nothing else, whatever scopes it asks for', async () => {
    const worker = boot()
    const owner = await adminToken(worker, 'owner')

    const made = await call(worker, owner, '/v1/admin/tokens', {
      label: 'Site',
      kind: 'read',
      scopes: ['content:write'],
    })
    const created = await made.json<{ secret: string; kind: string; scopes: string[] }>()
    const read = await worker.send('/v1/site', { token: created.secret })
    const listed = await (
      await call(worker, owner, '/v1/admin/tokens')
    ).json<{ tokens: { kind: string; label: string }[] }>()
    const wrong = await call(worker, owner, '/v1/admin/tokens', { label: 'x', kind: 'admin' })

    expect(made.status).toBe(201)
    expect(created).toMatchObject({ kind: 'read', scopes: ['content:read'] })
    expect(created.secret).toMatch(/^hw_read_/)
    expect(read.status).toBe(200)
    expect(listed.tokens.find((token) => token.label === 'Site')?.kind).toBe('read')
    expect(wrong.status).toBe(400)
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

  it('give a member another role, and remove one, whose token stops working at once', async () => {
    const worker = boot()
    const owner = await adminToken(worker, 'owner')
    const editor = await seedToken(env.DB, SITE_KEY, { role: 'editor' })

    const demoted = await call(worker, owner, '/v1/admin/people/role', {
      userId: editor.userId,
      role: 'author',
    })
    const same = await call(worker, owner, '/v1/admin/people/role', {
      userId: editor.userId,
      role: 'author',
    })
    const before = await worker.send('/v1/site', { token: editor.token })
    const removed = await call(worker, owner, '/v1/admin/people/remove', { userId: editor.userId })
    const after = await worker.send('/v1/site', { token: editor.token })
    const stranger = await call(worker, owner, '/v1/admin/people/remove', { userId: editor.userId })

    expect([await demoted.json(), await same.json()]).toEqual([
      { outcome: 'changed' },
      { outcome: 'unchanged' },
    ])
    expect([before.status, removed.status, after.status, stranger.status]).toEqual([
      200, 200, 401, 404,
    ])
  })

  it('keep the last owner of the site: neither demoted nor removed until another owner exists', async () => {
    const worker = boot()
    const owner = await adminPerson(worker, 'owner')
    const editor = await seedToken(env.DB, SITE_KEY, { role: 'editor' })
    // The one owner of the site from here on.
    await env.DB.prepare(
      "UPDATE members SET role = 'editor' WHERE site_id = ?1 AND role = 'owner' AND user_id <> ?2",
    )
      .bind(SITE_KEY, owner.userId)
      .run()

    const demote = await call(worker, owner.access, '/v1/admin/people/role', {
      userId: owner.userId,
      role: 'editor',
    })
    const remove = await call(worker, owner.access, '/v1/admin/people/remove', {
      userId: owner.userId,
    })
    const promoted = await call(worker, owner.access, '/v1/admin/people/role', {
      userId: editor.userId,
      role: 'owner',
    })
    const stepDown = await call(worker, owner.access, '/v1/admin/people/role', {
      userId: owner.userId,
      role: 'editor',
    })

    expect([demote.status, remove.status]).toEqual([409, 409])
    expect(await demote.json()).toMatchObject({ code: 'conflict' })
    expect([promoted.status, stepDown.status]).toEqual([200, 200])
  })
})
