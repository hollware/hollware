import { defineConfig } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'

import { connect } from '../../src/db/d1.ts'
import { createSession } from '../../src/identity/store.ts'
import { seedToken } from '../auth/support.ts'
import { callRaw, INPUTS } from '../mcp/support.ts'
import {
  boot,
  captureLogs,
  CONFIG,
  NOW,
  onlyCall,
  OTHER_SITE_KEY,
  PUBLIC_URL,
  restoreLogs,
  SITE_KEY,
  type Booted,
} from '../http/support.ts'

// Fails when: the OAuth server of ADR-026 stops letting an agent in the way it says. Its metadata
// names the endpoints, takes Client ID Metadata Documents, and has no registration endpoint unless
// the config turns it on; `/authorize` sends a person without a session to sign in and back, lets
// the admin in with no consent page,
// offers only the scopes the person's role allows of those asked, and redirects with a code, or
// with `access_denied` when the person declines; the token endpoint trades the code, with PKCE,
// for an access token that `/mcp` accepts as the person, through the client, with the scopes the
// person allowed intersected with their role as it is at each request; and a token for `/mcp` is
// refused at `/v1`, as a token of another site's deployment is refused everywhere. src/oauth/server.ts and src/oauth/authorize.ts; KV and D1 are the real ones.

afterEach(() => {
  restoreLogs()
})

const MCP = `${PUBLIC_URL}/mcp`
const REDIRECT = 'https://agent.example.com/callback'
const ALL = 'content:read content:write content:publish'

/** The test config, with dynamic client registration on, so that a test can make a client. */
const WITH_REGISTRATION = defineConfig({ ...CONFIG, auth: { dynamicClientRegistration: true } })

/** Two sites, the second with the same collection, and registration on. */
const TWO_SITES = defineConfig({
  ...WITH_REGISTRATION,
  sites: Object.fromEntries(
    Object.values(CONFIG.sites).flatMap((site) => [
      [SITE_KEY, site],
      [OTHER_SITE_KEY, site],
    ]),
  ),
})

/** Makes the person a member of another site too, with this role. */
async function memberOf(userId: string, site: string, role: 'owner' | 'editor' | 'author') {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO sites (id, created_at, updated_at) VALUES (?1, ?2, ?2)',
  )
    .bind(site, NOW)
    .run()
  await env.DB.prepare(
    'INSERT INTO members (id, site_id, user_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)',
  )
    .bind(`mem_${crypto.randomUUID()}`, site, userId, role, NOW)
    .run()
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** A PKCE pair (RFC 7636, S256). */
async function pkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

/** The cookies a response sets, as a `Cookie` header sends them back. */
function cookiesOf(response: Response): string[] {
  return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0] ?? '')
}

/** A client that registered itself, as an MCP client without a metadata document does. */
async function register(worker: Booted): Promise<string> {
  const response = await worker.send('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Test agent',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
    }),
  })
  expect(response.status).toBe(201)
  const { client_id } = await response.json<{ client_id: string }>()
  return client_id
}

/** A person of the site with this role, signed in: the cookie of their session. */
async function signedIn(role: 'owner' | 'editor' | 'author', site = SITE_KEY) {
  const { userId } = await seedToken(env.DB, site, { role })
  const session = await createSession(connect(env.DB), {
    userId,
    now: new Date(NOW),
    hours: 12,
  })
  return { userId, cookie: `hollware_session=${session.secret}` }
}

function authorizeUrl(clientId: string, challenge: string, scope = ALL): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope,
    state: 'state-1',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: MCP,
  })
  return `/authorize?${query.toString()}`
}

/** The consent page: the handle its form posts, the scopes it offers, and its binding cookies. */
async function consent(worker: Booted, clientId: string, challenge: string, cookie: string) {
  const page = await worker.send(authorizeUrl(clientId, challenge), { headers: { cookie } })
  expect(page.status).toBe(200)
  const html = await page.text()
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? ''
  const offered = [...html.matchAll(/name="scope" value="([^"]+)"/g)].map((match) => match[1])
  return { page, html, handle, offered, cookies: [cookie, ...cookiesOf(page)].join('; ') }
}

/** Allows the scopes given, and follows the redirect to the code. */
async function allow(
  worker: Booted,
  handle: string,
  cookies: string,
  scopes: readonly string[],
  site = SITE_KEY,
) {
  const form = new URLSearchParams({ handle, decision: 'approve', site })
  for (const scope of scopes) form.append('scope', scope)
  return await worker.send('/authorize', {
    method: 'POST',
    headers: {
      cookie: cookies,
      'content-type': 'application/x-www-form-urlencoded',
      origin: PUBLIC_URL,
    },
    body: form.toString(),
  })
}

async function exchange(worker: Booted, clientId: string, code: string, verifier: string) {
  const response = await worker.send('/oauth/token', {
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
  expect(response.status).toBe(200)
  return await response.json<{ access_token: string; refresh_token: string; scope: string }>()
}

/** The whole flow, for a person of this role who allows what the page offers. */
async function tokenFor(worker: Booted, role: 'owner' | 'editor' | 'author', site = SITE_KEY) {
  const person = await signedIn(role, site)
  const clientId = await register(worker)
  const { verifier, challenge } = await pkce()
  const { handle, offered, cookies } = await consent(worker, clientId, challenge, person.cookie)
  const redirect = await allow(
    worker,
    handle,
    cookies,
    offered.filter((scope) => scope !== undefined),
    site,
  )
  const code = new URL(redirect.headers.get('location') ?? '').searchParams.get('code') ?? ''
  const tokens = await exchange(worker, clientId, code, verifier)
  return { ...person, clientId, offered, tokens }
}

describe('the metadata of the OAuth server', () => {
  it('names its endpoints and takes metadata documents, and has no registration by default', async () => {
    const worker = boot()

    const metadata = await (await worker.send('/.well-known/oauth-authorization-server')).json()
    const registration = await worker.send('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'x', redirect_uris: [REDIRECT] }),
    })

    expect(metadata).toMatchObject({
      issuer: PUBLIC_URL,
      authorization_endpoint: `${PUBLIC_URL}/authorize`,
      token_endpoint: `${PUBLIC_URL}/oauth/token`,
      scopes_supported: ['content:read', 'content:write', 'content:publish', 'schema:admin'],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      protected_resources: [MCP, `${PUBLIC_URL}/v1`],
    })
    expect(metadata).not.toHaveProperty('registration_endpoint')
    expect(registration.status).toBe(404)
  })

  it('names the authorization server and the baseline scope for each resource', async () => {
    const worker = boot()

    const mcp = await (await worker.send('/.well-known/oauth-protected-resource/mcp')).json()

    expect(mcp).toEqual({
      resource: MCP,
      authorization_servers: [PUBLIC_URL],
      scopes_supported: ['content:read'],
      bearer_methods_supported: ['header'],
      resource_name: 'Hollware MCP',
    })
  })
})

describe('the authorization endpoint', () => {
  it('sends a person without a session to sign in, and back here after', async () => {
    const worker = boot({ config: WITH_REGISTRATION })
    const clientId = await register(worker)
    const { challenge } = await pkce()
    const path = authorizeUrl(clientId, challenge)

    const response = await worker.send(path)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`/signin?return_to=${encodeURIComponent(path)}`)
  })

  it('offers only the scopes the role allows of those asked, on a page nothing frames', async () => {
    const worker = boot({ config: WITH_REGISTRATION })
    const author = await signedIn('author')
    const clientId = await register(worker)
    const { challenge } = await pkce()

    const { page, html, offered } = await consent(worker, clientId, challenge, author.cookie)

    expect(offered).toEqual(['content:read', 'content:write'])
    expect(html).toContain('This app registered itself: its name is not verified.')
    expect(html).toContain('Access goes to <strong>agent.example.com</strong>')
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })

  it('asks which site when the person is in two, and grants the one they choose, if theirs', async () => {
    const worker = boot({ config: TWO_SITES })
    const person = await signedIn('author')
    await memberOf(person.userId, OTHER_SITE_KEY, 'editor')
    const clientId = await register(worker)
    const { verifier, challenge } = await pkce()

    const { html, handle, offered, cookies } = await consent(
      worker,
      clientId,
      challenge,
      person.cookie,
    )
    const stranger = await allow(worker, handle, cookies, ['content:read'], 'no-such-site')
    const again = await consent(worker, clientId, challenge, person.cookie)
    const chosen = await allow(
      worker,
      again.handle,
      again.cookies,
      // A forged form that asks for more than an editor may have.
      ['content:read', 'content:publish', 'schema:admin'],
      OTHER_SITE_KEY,
    )
    const code = new URL(chosen.headers.get('location') ?? '').searchParams.get('code') ?? ''
    const tokens = await exchange(worker, clientId, code, verifier)
    await callRaw(worker.endpoint(tokens.access_token), 'modern', 'describe_site', {})

    expect(html).toContain(`<input type="radio" name="site" value="${SITE_KEY}" checked>`)
    expect(html).toContain(`<input type="radio" name="site" value="${OTHER_SITE_KEY}">`)
    // The union of what the roles allow: the editor of the other site may publish.
    expect(offered).toEqual(['content:read', 'content:write', 'content:publish'])
    expect(stranger.status).toBe(403)
    expect(tokens.scope).toBe('content:read content:publish')
    expect(onlyCall(worker.seen).context).toMatchObject({
      site: { key: OTHER_SITE_KEY },
      principal: { scopes: ['content:read', 'content:publish'] },
    })
  })

  it('lets the admin, its own client, in without a consent page, within the role', async () => {
    const worker = boot()
    const author = await signedIn('author')
    const admin = await (
      await worker.send('/admin/config.json')
    ).json<{
      clientId: string
      redirectUri: string
      resource: string
      scope: string
    }>()
    const { challenge } = await pkce()
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: admin.clientId,
      redirect_uri: admin.redirectUri,
      scope: admin.scope,
      state: 'admin-state',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: admin.resource,
    })

    const response = await worker.send(`/authorize?${query.toString()}`, {
      headers: { cookie: author.cookie },
    })

    const location = new URL(response.headers.get('location') ?? '')
    expect(response.status).toBe(302)
    expect(`${location.origin}${location.pathname}`).toBe(admin.redirectUri)
    expect(location.searchParams.get('state')).toBe('admin-state')
    expect(location.searchParams.get('code')).toMatch(/\S+/)
  })

  it('redirects with access_denied and the state when the person declines', async () => {
    const worker = boot({ config: WITH_REGISTRATION })
    const owner = await signedIn('owner')
    const clientId = await register(worker)
    const { challenge } = await pkce()
    const { handle, cookies } = await consent(worker, clientId, challenge, owner.cookie)

    const response = await worker.send('/authorize', {
      method: 'POST',
      headers: {
        cookie: cookies,
        'content-type': 'application/x-www-form-urlencoded',
        origin: PUBLIC_URL,
      },
      // A browser sends the boxes that are checked with whichever button was pressed.
      body: new URLSearchParams([
        ['handle', handle],
        ['scope', 'content:read'],
        ['decision', 'deny'],
      ]).toString(),
    })

    const location = new URL(response.headers.get('location') ?? '')
    expect(response.status).toBe(302)
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT)
    expect(location.searchParams.get('error')).toBe('access_denied')
    expect(location.searchParams.get('state')).toBe('state-1')
  })
})

describe('an access token', () => {
  it('reaches /mcp as the person, through the client, with the scopes they allowed', async () => {
    const worker = boot({ config: WITH_REGISTRATION })
    const { userId, clientId, tokens } = await tokenFor(worker, 'author')

    const answer = await callRaw(
      worker.endpoint(tokens.access_token),
      'modern',
      'list_entries',
      INPUTS.list_entries,
    )

    expect(tokens.scope).toBe('content:read content:write')
    expect(answer.status).toBe(200)
    expect(onlyCall(worker.seen).context.principal).toEqual({
      kind: 'oauth',
      userId,
      clientId,
      site: SITE_KEY,
      scopes: ['content:read', 'content:write'],
    })
  })

  it('does what the role allows at each request: a demoted owner loses publish at once', async () => {
    const worker = boot({ config: WITH_REGISTRATION })
    const { userId, tokens } = await tokenFor(worker, 'owner')
    await env.DB.prepare("UPDATE members SET role = 'author' WHERE user_id = ?1").bind(userId).run()

    await callRaw(
      worker.endpoint(tokens.access_token),
      'modern',
      'list_entries',
      INPUTS.list_entries,
    )

    expect(tokens.scope).toBe(ALL)
    expect(onlyCall(worker.seen).context.principal).toMatchObject({
      scopes: ['content:read', 'content:write'],
    })
  })

  it('is refused by the deployment of another site, though it shares the KV and the URL', async () => {
    const [definition] = Object.values(CONFIG.sites)
    if (definition === undefined) throw new Error('the test config has no site')
    const other = boot({
      config: defineConfig({
        sites: { [OTHER_SITE_KEY]: definition },
        auth: { dynamicClientRegistration: true },
      }),
    })
    const { tokens } = await tokenFor(other, 'owner', OTHER_SITE_KEY)
    const logs = captureLogs()

    const response = await callRaw(
      boot().endpoint(tokens.access_token),
      'modern',
      'list_entries',
      INPUTS.list_entries,
    )

    expect(response.status).toBe(401)
    expect(logs.entries()).toContainEqual(expect.objectContaining({ reason: 'other_site' }))
  })

  it('is refused at /v1: it was issued for /mcp', async () => {
    const worker = boot({ config: WITH_REGISTRATION })
    const { tokens } = await tokenFor(worker, 'owner')

    const response = await worker.send('/v1/site', { token: tokens.access_token })

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"')
  })
})
