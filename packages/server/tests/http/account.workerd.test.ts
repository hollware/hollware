import { defineConfig } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { connect } from '../../src/db/d1.ts'
import { addPasskey, createSession } from '../../src/identity/store.ts'
import { seedToken } from '../auth/support.ts'
import { callRaw, INPUTS } from '../mcp/support.ts'
import { boot, CONFIG, NOW, PUBLIC_URL, SITE_KEY, type Booted } from './support.ts'

// Fails when: the routes of a person's own sign-in (src/http/admin-api.ts `/v1/admin/account`,
// src/identity/store.ts, and the sign-out of src/identity/routes.ts) stop doing what T-44, T-45
// and T-54 of docs/security/threat-model.md say: the list of passkeys shows their key or credential
// id, or misses one; a passkey is removed that is the person's last, or another person's; the list
// of apps misses a grant, its client's name, its scopes or its site, or does not mark the admin's;
// an app's grant is revoked that is another person's or the admin's, or a revoked grant's tokens
// keep working; ending every session leaves a row of the person, ends another person's, or leaves
// the admin's grants; or signing out of one browser leaves its session, ends another one, or
// leaves the cookie; or a passkey is renamed that is another person's, or to an empty label; or
// the name of anyone but the person signed in changes, or a name longer than 100 characters is kept.

const REDIRECT = 'https://agent.example.com/callback'
const MCP = `${PUBLIC_URL}/mcp`

/** The test config, with dynamic client registration on, so that a test can make a client. */
const WITH_REGISTRATION = defineConfig({ ...CONFIG, auth: { dynamicClientRegistration: true } })

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function pkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

/** A session of the person: the cookie a browser that signed in holds. */
async function sessionOf(userId: string): Promise<string> {
  const session = await createSession(connect(env.DB), { userId, now: new Date(NOW), hours: 12 })
  return `hollware_session=${session.secret}`
}

/** A person of the site, an owner, signed in to the admin: their id, cookie and access token. */
async function person(worker: Booted) {
  const { userId } = await seedToken(env.DB, SITE_KEY, { role: 'owner' })
  const cookie = await sessionOf(userId)
  const admin = await (
    await worker.send('/admin/config.json')
  ).json<{ clientId: string; redirectUri: string; resource: string; scope: string }>()
  const { verifier, challenge } = await pkce()
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: admin.clientId,
    redirect_uri: admin.redirectUri,
    scope: admin.scope,
    state: 's',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: admin.resource,
  })
  const redirect = await worker.send(`/authorize?${query.toString()}`, { headers: { cookie } })
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
  const access = (await tokens.json<{ access_token: string }>()).access_token
  return { userId, cookie, access, adminClient: admin.clientId }
}

/** An app the person connects through the consent page, as an agent does: its client and tokens. */
async function connectApp(worker: Booted, cookie: string, name: string) {
  const registered = await worker.send('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
    }),
  })
  const { client_id: clientId } = await registered.json<{ client_id: string }>()
  const { verifier, challenge } = await pkce()
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'content:read content:write',
    state: 'state-1',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: MCP,
  })
  const page = await worker.send(`/authorize?${query.toString()}`, { headers: { cookie } })
  const html = await page.text()
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? ''
  const cookies = [cookie, ...page.headers.getSetCookie().map((c) => c.split(';')[0] ?? '')]
  const form = new URLSearchParams({ handle, decision: 'approve', site: SITE_KEY })
  form.append('scope', 'content:read')
  form.append('scope', 'content:write')
  const allowed = await worker.send('/authorize', {
    method: 'POST',
    headers: {
      cookie: cookies.join('; '),
      'content-type': 'application/x-www-form-urlencoded',
      origin: PUBLIC_URL,
    },
    body: form.toString(),
  })
  const code = new URL(allowed.headers.get('location') ?? '').searchParams.get('code') ?? ''
  const exchanged = await worker.send('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
      resource: MCP,
    }).toString(),
  })
  const tokens = await exchanged.json<{ access_token: string; refresh_token: string }>()
  return { clientId, access: tokens.access_token, refresh: tokens.refresh_token }
}

/** Whether a token of an app still reaches /mcp: the status of a call. */
async function mcpStatus(worker: Booted, token: string): Promise<number> {
  return (await callRaw(worker.endpoint(token), 'modern', 'list_entries', INPUTS.list_entries))
    .status
}

/** The status of a refresh of an app's grant, at the token endpoint. */
async function refreshStatus(worker: Booted, clientId: string, refresh: string): Promise<number> {
  const response = await worker.send('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: clientId,
      resource: MCP,
    }).toString(),
  })
  return response.status
}

async function passkey(userId: string, label: string, createdAt: string): Promise<string> {
  await addPasskey(connect(env.DB), {
    userId,
    credentialId: `cred-${crypto.randomUUID()}`,
    publicKey: 'cHVibGljLWtleQ',
    counter: 0,
    transports: ['internal'],
    label,
    now: new Date(createdAt),
  })
  const row = await env.DB.prepare('SELECT id FROM passkeys WHERE user_id = ?1 AND label = ?2')
    .bind(userId, label)
    .first<{ id: string }>()
  return row?.id ?? ''
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

async function passkeyIds(userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT id FROM passkeys WHERE user_id = ?1 ORDER BY created_at',
  )
    .bind(userId)
    .all<{ id: string }>()
  return results.map((row) => row.id)
}

async function sessionCount(userId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT count(*) AS n FROM sessions WHERE user_id = ?1')
    .bind(userId)
    .first<{ n: number }>()
  return row?.n ?? -1
}

/** Where `/authorize` sends a browser with this cookie: back to sign in, or on with a code. */
async function authorizeWith(worker: Booted, adminClient: string, cookie: string) {
  const { challenge } = await pkce()
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: adminClient,
    redirect_uri: `${PUBLIC_URL}/admin/callback`,
    scope: 'content:read',
    state: 's',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${PUBLIC_URL}/v1`,
  })
  const response = await worker.send(`/authorize?${query.toString()}`, { headers: { cookie } })
  return new URL(response.headers.get('location') ?? '', PUBLIC_URL).pathname
}

/** The lines of the activity log of a person's own action (ADR-037): outcome, code and target. */
async function auditOf(userId: string, action: string) {
  const { results } = await env.DB.prepare(
    'SELECT outcome, error_code, target_id FROM audit_log WHERE actor_user_id = ?1 AND action = ?2 ORDER BY created_at, id',
  )
    .bind(userId, action)
    .all<{ outcome: string; error_code: string | null; target_id: string }>()
  return results.map((row) => [row.outcome, row.error_code, row.target_id])
}

describe("a person's passkeys (T-54)", () => {
  it('lists them by label and dates, never their key or credential id', async () => {
    const worker = boot()
    const me = await person(worker)
    const laptop = await passkey(me.userId, 'Laptop', '2026-10-01T09:00:00.000Z')
    const phone = await passkey(me.userId, 'Phone', '2026-10-02T09:00:00.000Z')

    const answer = await call(worker, me.access, '/v1/admin/account')
    const body = await answer.json<{ passkeys: unknown }>()

    expect(answer.status).toBe(200)
    expect(body.passkeys).toEqual([
      { id: laptop, label: 'Laptop', createdAt: '2026-10-01T09:00:00.000Z', lastUsedAt: null },
      { id: phone, label: 'Phone', createdAt: '2026-10-02T09:00:00.000Z', lastUsedAt: null },
    ])
    expect(JSON.stringify(body)).not.toContain('cred-')
    expect(JSON.stringify(body)).not.toContain('cHVibGljLWtleQ')
  })

  it('removes one, and refuses the last one, which stays', async () => {
    const worker = boot()
    const me = await person(worker)
    const laptop = await passkey(me.userId, 'Laptop', '2026-10-01T09:00:00.000Z')
    const phone = await passkey(me.userId, 'Phone', '2026-10-02T09:00:00.000Z')

    const first = await call(worker, me.access, '/v1/admin/account/passkeys/remove', { id: laptop })
    const last = await call(worker, me.access, '/v1/admin/account/passkeys/remove', { id: phone })

    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ outcome: 'removed', id: laptop })
    expect(last.status).toBe(409)
    expect(await last.json()).toMatchObject({ code: 'conflict' })
    expect(await passkeyIds(me.userId)).toEqual([phone])
    expect(await auditOf(me.userId, 'passkey.remove')).toEqual([
      ['ok', null, laptop],
      ['failed', 'conflict', phone],
    ])
  })

  it("refuses another person's passkey, though the person has two of their own", async () => {
    const worker = boot()
    const me = await person(worker)
    await passkey(me.userId, 'Laptop', '2026-10-01T09:00:00.000Z')
    await passkey(me.userId, 'Phone', '2026-10-02T09:00:00.000Z')
    const other = await seedToken(env.DB, SITE_KEY, { role: 'editor' })
    const theirs = await passkey(other.userId, 'Theirs', '2026-10-01T09:00:00.000Z')
    await passkey(other.userId, 'Theirs too', '2026-10-02T09:00:00.000Z')

    const answer = await call(worker, me.access, '/v1/admin/account/passkeys/remove', {
      id: theirs,
    })

    expect(answer.status).toBe(404)
    expect(await passkeyIds(other.userId)).toHaveLength(2)
    expect(await passkeyIds(me.userId)).toHaveLength(2)
  })
})

describe('the apps a person connected (T-45)', () => {
  it('lists each grant with its client, scopes and site, and marks the admin', async () => {
    const worker = boot({ config: WITH_REGISTRATION })
    const me = await person(worker)
    const app = await connectApp(worker, me.cookie, 'Writing agent')

    const body = await (
      await call(worker, me.access, '/v1/admin/account')
    ).json<{ apps: Record<string, unknown>[] }>()

    expect(body.apps).toHaveLength(2)
    expect(body.apps).toContainEqual(
      expect.objectContaining({
        clientId: app.clientId,
        name: 'Writing agent',
        scopes: ['content:read', 'content:write'],
        site: SITE_KEY,
        admin: false,
      }),
    )
    expect(body.apps).toContainEqual(
      expect.objectContaining({ clientId: me.adminClient, name: 'Hollware admin', admin: true }),
    )
  })

  it("revokes one, whose tokens stop at once, and refuses the admin's", async () => {
    const worker = boot({ config: WITH_REGISTRATION })
    const me = await person(worker)
    const app = await connectApp(worker, me.cookie, 'Writing agent')
    const { apps } = await (
      await call(worker, me.access, '/v1/admin/account')
    ).json<{ apps: { grantId: string; admin: boolean }[] }>()
    const grant = apps.find((a) => !a.admin)?.grantId ?? ''
    const ours = apps.find((a) => a.admin)?.grantId ?? ''
    const before = await mcpStatus(worker, app.access)

    const revoked = await call(worker, me.access, '/v1/admin/account/apps/revoke', {
      grantId: grant,
    })
    const admin = await call(worker, me.access, '/v1/admin/account/apps/revoke', { grantId: ours })

    expect(before).toBe(200)
    expect(revoked.status).toBe(200)
    expect(await revoked.json()).toEqual({ outcome: 'revoked', grantId: grant })
    expect(await mcpStatus(worker, app.access)).toBe(401)
    expect(await refreshStatus(worker, app.clientId, app.refresh)).toBe(400)
    expect(admin.status).toBe(409)
    expect((await call(worker, me.access, '/v1/admin/account')).status).toBe(200)
    expect(await auditOf(me.userId, 'app.revoke')).toEqual([
      ['ok', null, grant],
      ['failed', 'conflict', ours],
    ])
  })

  it("refuses another person's grant, which keeps working", async () => {
    const worker = boot({ config: WITH_REGISTRATION })
    const me = await person(worker)
    const other = await person(worker)
    const theirs = await connectApp(worker, other.cookie, 'Their agent')
    const { apps } = await (
      await call(worker, other.access, '/v1/admin/account')
    ).json<{ apps: { grantId: string; admin: boolean }[] }>()
    const grant = apps.find((a) => !a.admin)?.grantId ?? ''

    const answer = await call(worker, me.access, '/v1/admin/account/apps/revoke', {
      grantId: grant,
    })

    expect(answer.status).toBe(404)
    expect(await mcpStatus(worker, theirs.access)).toBe(200)
  })
})

describe("a person's sessions (T-44)", () => {
  it("ends every session of the person, and the admin's grants, and no one else's", async () => {
    const worker = boot({ config: WITH_REGISTRATION })
    const me = await person(worker)
    const elsewhere = await sessionOf(me.userId)
    const app = await connectApp(worker, me.cookie, 'Writing agent')
    const other = await person(worker)

    const answer = await call(worker, me.access, '/v1/admin/account/sessions/end', {})

    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ outcome: 'ended', sessions: 2, adminGrants: 1 })
    expect(await sessionCount(me.userId)).toBe(0)
    expect(await authorizeWith(worker, me.adminClient, elsewhere)).toBe('/signin')
    expect(await authorizeWith(worker, me.adminClient, me.cookie)).toBe('/signin')
    // The admin's token is gone with its grant; the app the person connected keeps working.
    expect((await call(worker, me.access, '/v1/admin/account')).status).toBe(401)
    expect(await mcpStatus(worker, app.access)).toBe(200)
    expect(await sessionCount(other.userId)).toBe(1)
    expect(await authorizeWith(worker, other.adminClient, other.cookie)).toBe('/admin/callback')
  })

  it('signs one browser out: its session and cookie end, the other browser stays in', async () => {
    const worker = boot()
    const me = await person(worker)
    const elsewhere = await sessionOf(me.userId)

    const answer = await worker.send('/authorize/signout', {
      method: 'POST',
      headers: { cookie: me.cookie, origin: PUBLIC_URL },
    })
    const forged = await worker.send('/authorize/signout', {
      method: 'POST',
      headers: { cookie: elsewhere, origin: 'https://evil.example' },
    })

    expect(answer.status).toBe(200)
    expect(answer.headers.get('set-cookie')).toBe(
      'hollware_session=; HttpOnly; Secure; SameSite=Lax; Path=/authorize; Max-Age=0',
    )
    expect(await sessionCount(me.userId)).toBe(1)
    expect(await authorizeWith(worker, me.adminClient, me.cookie)).toBe('/signin')
    expect(forged.status).toBe(403)
    expect(await authorizeWith(worker, me.adminClient, elsewhere)).toBe('/admin/callback')
  })
})

describe("a person's name and the labels of their passkeys", () => {
  it('renames one of their passkeys, never another person’s, and refuses an empty label', async () => {
    const worker = boot()
    const me = await person(worker)
    const other = await person(worker)
    const laptop = await passkey(me.userId, 'Laptop', '2026-10-01T09:00:00.000Z')
    const theirs = await passkey(other.userId, 'Theirs', '2026-10-01T09:00:00.000Z')

    const renamed = await call(worker, me.access, '/v1/admin/account/passkeys/rename', {
      id: laptop,
      label: '  Work   laptop ',
    })
    const stolen = await call(worker, me.access, '/v1/admin/account/passkeys/rename', {
      id: theirs,
      label: 'Mine now',
    })
    const empty = await call(worker, me.access, '/v1/admin/account/passkeys/rename', {
      id: laptop,
      label: '   ',
    })

    expect([renamed.status, stolen.status, empty.status]).toEqual([200, 404, 400])
    const labels = await env.DB.prepare('SELECT id, label FROM passkeys WHERE id IN (?1, ?2)')
      .bind(laptop, theirs)
      .all<{ id: string; label: string }>()
    expect(Object.fromEntries(labels.results.map((row) => [row.id, row.label]))).toEqual({
      [laptop]: 'Work laptop',
      [theirs]: 'Theirs',
    })
    expect(await auditOf(me.userId, 'passkey.rename')).toEqual([
      ['ok', null, laptop],
      ['failed', 'not_found', theirs],
    ])
  })

  it('changes the name of the person signed in, and only theirs', async () => {
    const worker = boot()
    const me = await person(worker)
    const other = await person(worker)
    const nameOf = async (userId: string) =>
      (
        await env.DB.prepare('SELECT name FROM users WHERE id = ?1')
          .bind(userId)
          .first<{ name: string | null }>()
      )?.name

    const before = await nameOf(other.userId)
    const renamed = await call(worker, me.access, '/v1/admin/account/name', {
      name: 'Ada Lovelace',
    })
    const tooLong = await call(worker, me.access, '/v1/admin/account/name', {
      name: 'a'.repeat(101),
    })
    const me2 = await (
      await call(worker, me.access, '/v1/admin/me')
    ).json<{
      user: { name: string }
    }>()

    expect([renamed.status, tooLong.status]).toEqual([200, 400])
    expect(me2.user.name).toBe('Ada Lovelace')
    expect(await nameOf(other.userId)).toBe(before)
    expect(await auditOf(me.userId, 'account.rename')).toEqual([['ok', null, me.userId]])
  })
})
