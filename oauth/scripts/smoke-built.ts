// Runs the OAuth flow over real HTTP against the BUILT Worker served by `wrangler dev`, whose
// compatibility flags are the ones of wrangler.jsonc: no nodejs_compat. The vitest runner turns
// Node APIs on, so only this run shows the provider and Hono working without them.
//
//   node scripts/smoke-built.ts http://localhost:5251            (topology A, the default)
//   node scripts/smoke-built.ts http://localhost:5251 roles      (topology B)
import assert from 'node:assert/strict'

const base = process.argv[2]
const topology = process.argv[3] === 'roles' ? 'roles' : 'provider'
if (base === undefined) throw new Error('usage: node scripts/smoke-built.ts <base-url> [roles]')

const resource = topology === 'roles' ? `${base}/mcp` : base
const metadataUrl =
  topology === 'roles'
    ? `${base}/.well-known/oauth-protected-resource/mcp`
    : `${base}/.well-known/oauth-protected-resource`
const redirectUri = 'https://client.test/callback'
// RFC 7636 appendix B
const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

function form(values: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values).toString(),
  }
}

const bearer = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}` } })

// 1. What the Worker runs with.
const runtime = await json(await fetch(`${base}/runtime`))
assert.deepEqual(runtime, {
  nodejsCompat: false,
  nodejsCompatV2: false,
  globalFetchStrictlyPublic: true,
  hasProcess: false,
  hasBuffer: false,
})

// 2. Metadata: the issuer is the configured URL.
const metadata = await json(await fetch(`${base}/.well-known/oauth-authorization-server`))
assert.equal(metadata.issuer, base)
assert.equal(metadata.client_id_metadata_document_supported, true)
const prm = await json(await fetch(metadataUrl))
assert.equal(prm.resource, resource)

// 3. 401 with the challenge.
const unauthenticated = await fetch(`${base}/mcp`)
assert.equal(unauthenticated.status, 401)
assert.equal(
  unauthenticated.headers.get('www-authenticate'),
  `Bearer realm="OAuth", resource_metadata="${metadataUrl}", scope="content:read"`,
)

// 4. Dynamic registration -> /authorize -> /oauth/token -> bearer call.
const registered = await fetch(`${base}/oauth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_name: 'Smoke Agent',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }),
})
assert.equal(registered.status, 201)
const clientId = String((await json(registered)).client_id)

const query = new URLSearchParams({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: redirectUri,
  scope: 'content:read content:write',
  state: 'smoke',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  resource,
})
const authorized = await fetch(`${base}/authorize?${query.toString()}`, { redirect: 'manual' })
assert.equal(authorized.status, 302)
const location = new URL(authorized.headers.get('location') ?? '')
assert.equal(location.searchParams.get('state'), 'smoke')
assert.equal(location.searchParams.get('iss'), base)
const code = location.searchParams.get('code') ?? ''

const exchanged = await fetch(
  `${base}/oauth/token`,
  form({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
    resource,
  }),
)
assert.equal(exchanged.status, 200)
const tokens = await json(exchanged)
assert.equal(tokens.token_type, 'bearer')
assert.equal(tokens.resource, resource)
const accessToken = String(tokens.access_token)

const api = await fetch(`${base}/mcp`, bearer(accessToken))
assert.equal(api.status, 200)
const seen = await json(api)
assert.deepEqual(seen.props, {
  userId: 'usr_spike',
  scopes: ['content:read', 'content:write'],
  via: 'oauth',
})

// 5. Refresh rotation.
const refreshed = await fetch(
  `${base}/oauth/token`,
  form({
    grant_type: 'refresh_token',
    refresh_token: String(tokens.refresh_token),
    client_id: clientId,
  }),
)
assert.equal(refreshed.status, 200)
const second = await json(refreshed)
assert.notEqual(second.refresh_token, tokens.refresh_token)
const third = await fetch(
  `${base}/oauth/token`,
  form({
    grant_type: 'refresh_token',
    refresh_token: String(second.refresh_token),
    client_id: clientId,
  }),
)
assert.equal(third.status, 200)
const stale = await fetch(
  `${base}/oauth/token`,
  form({
    grant_type: 'refresh_token',
    refresh_token: String(tokens.refresh_token),
    client_id: clientId,
  }),
)
assert.equal(stale.status, 400)
assert.deepEqual(await json(stale), {
  error: 'invalid_grant',
  error_description: 'Invalid refresh token',
})

// 6. 403 insufficient_scope, personal tokens.
const readOnly = await signInWith('content:read')
const write = await fetch(`${base}/mcp`, { method: 'POST', ...bearer(readOnly) })
assert.equal(write.status, 403)
assert.equal(
  write.headers.get('www-authenticate'),
  `Bearer realm="OAuth", error="insufficient_scope", scope="content:read content:write", resource_metadata="${metadataUrl}"`,
)
assert.equal((await fetch(`${base}/mcp`, bearer('hw_pat_test'))).status, 200)
assert.equal((await fetch(`${base}/mcp`, bearer('hw_pat_unknown'))).status, 401)

// 7. Revocation.
const revoked = await fetch(
  `${base}/oauth/token`,
  form({ token: accessToken, token_type_hint: 'access_token', client_id: clientId }),
)
assert.equal(revoked.status, 200)
assert.equal((await fetch(`${base}/mcp`, bearer(accessToken))).status, 401)

console.log(`smoke ok (${topology}): ${base}`)

async function signInWith(scope: string): Promise<string> {
  const registeredAgain = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Smoke Agent 2',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
    }),
  })
  const id = String((await json(registeredAgain)).client_id)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    redirect_uri: redirectUri,
    scope,
    state: 'smoke',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource,
  })
  const approved = await fetch(`${base}/authorize?${params.toString()}`, { redirect: 'manual' })
  const issued = new URL(approved.headers.get('location') ?? '').searchParams.get('code') ?? ''
  const response = await fetch(
    `${base}/oauth/token`,
    form({
      grant_type: 'authorization_code',
      code: issued,
      redirect_uri: redirectUri,
      client_id: id,
      code_verifier: verifier,
      resource,
    }),
  )
  return String((await json(response)).access_token)
}
