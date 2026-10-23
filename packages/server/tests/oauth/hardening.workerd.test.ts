import { defineConfig } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { connect } from '../../src/db/d1.ts'
import { createSession } from '../../src/identity/store.ts'
import { seedToken } from '../auth/support.ts'
import { boot, CONFIG, NOW, PUBLIC_URL, SITE_KEY, type Booted } from '../http/support.ts'

const MCP = `${PUBLIC_URL}/mcp`
const REDIRECT = 'https://agent.example.com/callback'
const WITH_REGISTRATION = defineConfig({ ...CONFIG, auth: { dynamicClientRegistration: true } })

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function challengeOf(verifier: string): Promise<string> {
  return base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  )
}

async function register(worker: Booted, name = 'Test agent'): Promise<string> {
  const response = await worker.send('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
    }),
  })
  expect(response.status).toBe(201)
  return (await response.json<{ client_id: string }>()).client_id
}

async function personOf(role: 'owner' | 'author' = 'owner') {
  const { userId } = await seedToken(env.DB, SITE_KEY, { role })
  const session = await createSession(connect(env.DB), { userId, now: new Date(NOW), hours: 12 })
  return { userId, cookie: `hollware_session=${session.secret}` }
}

async function cookieOf(role: 'owner' | 'author' = 'owner') {
  return (await personOf(role)).cookie
}

function authorize(clientId: string, extra: Record<string, string>): string {
  return `/authorize?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'content:read',
    state: 's',
    resource: MCP,
    ...extra,
  }).toString()}`
}

describe('the OAuth server refuses', () => {
  it('a redirect URI other than the one registered, and sends nothing to it', async () => {
    const worker = boot({ config: WITH_REGISTRATION })
    const clientId = await register(worker)
    const challenge = await challengeOf('v'.repeat(43))

    const answer = await worker.send(
      authorize(clientId, {
        redirect_uri: 'https://agent.example.com/callback/../evil',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }),
      { headers: { cookie: await cookieOf() } },
    )

    expect(answer.status).toBeGreaterThanOrEqual(400)
    expect(answer.headers.get('location')).toBe(null)
  })

  it('PKCE plain, and no PKCE at all', async () => {
    const worker = boot({ config: WITH_REGISTRATION })
    const clientId = await register(worker)
    const cookie = await cookieOf()

    const plain = await worker.send(
      authorize(clientId, { code_challenge: 'v'.repeat(43), code_challenge_method: 'plain' }),
      { headers: { cookie } },
    )
    const none = await worker.send(authorize(clientId, {}), { headers: { cookie } })

    for (const answer of [plain, none]) {
      expect(answer.status === 200 && (await answer.clone().text()).includes('name="handle"')).toBe(
        false,
      )
      expect(new URL(answer.headers.get('location') ?? 'x:/').searchParams.get('code')).toBe(null)
    }
  })

  it('a consent posted without the cookie that binds it, and grants another person only their own', async () => {
    const worker = boot({ config: WITH_REGISTRATION })
    const clientId = await register(worker)
    const first = await personOf('owner')
    const owner = first.cookie
    const page = await worker.send(
      authorize(clientId, {
        code_challenge: await challengeOf('w'.repeat(43)),
        code_challenge_method: 'S256',
      }),
      { headers: { cookie: owner } },
    )
    const handle = /name="handle" value="([^"]+)"/.exec(await page.text())?.[1] ?? ''
    const bound = (page.headers.getSetCookie?.() ?? []).map((line) => line.split(';')[0]).join('; ')
    expect(handle).not.toBe('')
    const post = (cookie: string) =>
      worker.send('/authorize', {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
          origin: PUBLIC_URL,
        },
        body: new URLSearchParams({
          handle,
          decision: 'approve',
          site: SITE_KEY,
          scope: 'content:read',
        }).toString(),
      })

    const second = await personOf('owner')
    const withoutBinding = await post(owner)
    const otherPerson = await post(`${second.cookie}; ${bound}`)

    expect([withoutBinding.status, withoutBinding.headers.get('location')]).toEqual([400, null])
    const code =
      new URL(otherPerson.headers.get('location') ?? 'x:/').searchParams.get('code') ?? ''
    expect(code.startsWith(`${second.userId}:`)).toBe(true)
    expect(code.startsWith(`${first.userId}:`)).toBe(false)
  })

  it('a client name as markup on the consent page', async () => {
    const worker = boot({ config: WITH_REGISTRATION })
    const clientId = await register(worker, '<img src=x onerror=alert(1)><script>alert(2)</script>')

    const page = await worker.send(
      authorize(clientId, {
        code_challenge: await challengeOf('x'.repeat(43)),
        code_challenge_method: 'S256',
      }),
      { headers: { cookie: await cookieOf() } },
    )
    const html = await page.text()

    expect(page.status).toBe(200)
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert(2)')
    expect(html).toContain('&#60;img src=x onerror=alert(1)&#62;')
  })

  it('a session cookie in place of a token, at /mcp and at /v1', async () => {
    const worker = boot()
    const cookie = await cookieOf()

    const mcp = await worker.send('/mcp', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    const v1 = await worker.send('/v1/site', { headers: { cookie } })
    const admin = await worker.send('/v1/admin/me', { headers: { cookie } })

    expect([mcp.status, v1.status, admin.status]).toEqual([401, 401, 401])
  })
})
