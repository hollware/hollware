import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { seedToken } from '../auth/support.ts'
import { adminPerson, adminToken, call } from './admin-session.ts'
import { boot, NOW, OTHER_SITE_KEY, SITE_KEY } from './support.ts'

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

  it('make a personal token that expires after 90 days when no days are given, one that never does when asked, a read token that never expires, and one with its days', async () => {
    const worker = boot()
    const owner = await adminToken(worker, 'owner')

    const standard = await (
      await call(worker, owner, '/v1/admin/tokens', { label: 'CI', scopes: ['content:read'] })
    ).json<{ expiresAt: string | null }>()
    const forever = await (
      await call(worker, owner, '/v1/admin/tokens', {
        label: 'Pipeline',
        scopes: ['content:read'],
        expiresInDays: null,
      })
    ).json<{ expiresAt: string | null }>()
    const site = await (
      await call(worker, owner, '/v1/admin/tokens', { label: 'Site', kind: 'read' })
    ).json<{ expiresAt: string | null }>()
    const month = await (
      await call(worker, owner, '/v1/admin/tokens', {
        label: 'Laptop',
        scopes: ['content:read'],
        expiresInDays: 30,
      })
    ).json<{ expiresAt: string | null }>()
    const wrong = await call(worker, owner, '/v1/admin/tokens', {
      label: 'Bad',
      scopes: ['content:read'],
      expiresInDays: 0,
    })

    expect(standard.expiresAt).toBe('2027-01-11T12:00:00.000Z')
    expect(forever.expiresAt).toBe(null)
    expect(site.expiresAt).toBe(null)
    expect(month.expiresAt).toBe(new Date(Date.parse(NOW) + 30 * 86_400_000).toISOString())
    expect(wrong.status).toBe(400)
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
      link: expect.stringMatching(/^https:\/\/hollware\.test\/setup#invitation=hw_inv_/),
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
