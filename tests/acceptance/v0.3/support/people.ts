import type { TestHarness } from 'wrangler'
import { softAuthenticator } from '../../../../packages/server/tests/support/authenticator.ts'
import { HOLLWARE_WORKER } from '../../../../apps/playground/test/harness/workers.ts'
import { HOLLWARE_URL } from '../../v0.1/support/harness.ts'

/**
 * People of the acceptance suite of v0.3, who get in the way a person gets in: a passkey made by a
 * software authenticator, registered through a link, then the admin's OAuth client with PKCE. The
 * one thing written behind the Worker's back is the owner's setup link, which `hollware init`
 * writes into D1 the same way.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function post(server: TestHarness, path: string, body: object) {
  return server.fetch(`${HOLLWARE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: HOLLWARE_URL },
    body: JSON.stringify(body),
  })
}

/** The owner's setup link, as `hollware init` writes it: the secret of an owner invitation. */
export async function ownerSetupLink(server: TestHarness, site: string): Promise<string> {
  const { DB } = await server
    .getWorker<{
      DB: {
        prepare(sql: string): {
          bind(...values: unknown[]): { run(): Promise<unknown>; first(): Promise<unknown> }
        }
      }
    }>(HOLLWARE_WORKER)
    .getEnv()
  const owner = await DB.prepare(
    "SELECT user_id FROM members WHERE role = 'owner' AND site_id = ?1",
  )
    .bind(site)
    .first()
  if (!isRecord(owner) || typeof owner['user_id'] !== 'string') throw new Error('no owner')
  const secret = `hw_inv_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`
  await DB.prepare(
    `INSERT INTO invitations (id, site_id, hash, role, user_id, expires_at, used_at, created_at, updated_at)
      VALUES ('inv_01JAB3XQ8ZK4M6N2P5R7S9T0VA', ?1, ?2, 'owner', ?3, '2099-01-01T00:00:00.000Z', NULL, ?4, ?4)`,
  )
    .bind(site, await sha256(secret), owner['user_id'], new Date().toISOString())
    .run()
  return secret
}

/** Registers a passkey through an invitation, as the setup page does: the session cookie. */
export async function register(server: TestHarness, invitation: string, name: string) {
  const authenticator = await softAuthenticator(HOLLWARE_URL)
  const started: unknown = await (
    await post(server, '/auth/register/options', { invitation })
  ).json()
  if (
    !isRecord(started) ||
    typeof started['challengeId'] !== 'string' ||
    !isRecord(started['options'])
  ) {
    throw new Error(`no registration: ${JSON.stringify(started)}`)
  }
  const options = started['options']
  const user = isRecord(options['user']) ? String(options['user']['id']) : ''
  const done = await post(server, '/auth/register/verify', {
    challengeId: started['challengeId'],
    response: await authenticator.register({
      challenge: String(options['challenge']),
      user: { id: user },
    }),
    name,
    label: 'Laptop',
  })
  const cookie = done.headers.get('set-cookie')?.split(';')[0]
  if (done.status !== 200 || cookie === undefined) {
    throw new Error(`the passkey was not registered: ${done.status} ${await done.text()}`)
  }
  return cookie
}

/**
 * An access token of the admin's own client for the person of a session cookie, for a resource of
 * Hollware: `/v1` as the admin uses it, or `/mcp`, as an agent of that person would hold one.
 */
export async function accessToken(
  server: TestHarness,
  cookie: string,
  resource: 'v1' | 'mcp',
): Promise<string> {
  const config: unknown = await (await server.fetch(`${HOLLWARE_URL}/admin/config.json`)).json()
  if (!isRecord(config)) throw new Error('no admin config')
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  )
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: String(config['clientId']),
    redirect_uri: String(config['redirectUri']),
    scope: String(config['scope']),
    state: 'acceptance',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${HOLLWARE_URL}/${resource}`,
  })
  const redirect = await server.fetch(`${HOLLWARE_URL}/authorize?${query.toString()}`, {
    headers: { cookie },
    redirect: 'manual',
  })
  const code = new URL(redirect.headers.get('location') ?? '', HOLLWARE_URL).searchParams.get(
    'code',
  )
  if (code === null) throw new Error(`no code: ${redirect.status} ${await redirect.text()}`)
  const tokens: unknown = await (
    await server.fetch(`${HOLLWARE_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: String(config['redirectUri']),
        client_id: String(config['clientId']),
        code_verifier: verifier,
        resource: `${HOLLWARE_URL}/${resource}`,
      }).toString(),
    })
  ).json()
  if (!isRecord(tokens) || typeof tokens['access_token'] !== 'string') {
    throw new Error(`no token: ${JSON.stringify(tokens)}`)
  }
  return tokens['access_token']
}

/** What the admin sends: one of its routes or an operation over `/v1`, with its token. */
export async function adminCall(
  server: TestHarness,
  token: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await server.fetch(`${HOLLWARE_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const answer: unknown = await response.json()
  return { status: response.status, body: isRecord(answer) ? answer : {} }
}

/** The id and the version of the entry an answer names. */
export function entryOf(output: Record<string, unknown>): { id: string; version: number } {
  const entry = output['entry']
  if (!isRecord(entry) || typeof entry['id'] !== 'string' || typeof entry['version'] !== 'number') {
    throw new Error(`no entry: ${JSON.stringify(output)}`)
  }
  return { id: entry['id'], version: entry['version'] }
}

/** The ids and the names of who asked, of the reviews a listing answers. */
export function reviewsOf(
  output: Record<string, unknown>,
): { id: string; requestedByName: unknown }[] {
  const reviews = output['reviews']
  if (!Array.isArray(reviews)) throw new Error(`no reviews: ${JSON.stringify(output)}`)
  return reviews.filter(isRecord).map((review) => ({
    id: String(review['id']),
    requestedByName: review['requestedByName'],
  }))
}
