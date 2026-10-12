/** How the tests reach the Worker under test: `(url, init) => exports.default.fetch(url, init)`. */
export type Send = (input: string, init?: RequestInit) => Promise<Response>

// RFC 7636 appendix B: the verifier and the S256 challenge it hashes to.
export const PKCE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
export const PKCE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

export const REDIRECT_URI = 'https://client.test/callback'
export const STATE = 'state-123'

export interface RegisteredClient {
  client_id: string
  client_name: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  token_endpoint_auth_method: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  scope: string
  resource: string
}

export interface OAuthErrorBody {
  error: string
  error_description?: string
}

/** Dynamic client registration (RFC 7591) of a public client: PKCE, no secret. */
export async function register(send: Send, base: string): Promise<RegisteredClient> {
  const response = await send(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Spike Agent',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
  if (response.status !== 201) throw new Error(`registration answered ${response.status}`)
  return response.json<RegisteredClient>()
}

export interface AuthorizeOptions {
  clientId: string
  scope: string
  resource: string | null
  redirectUri?: string
}

/** GET /authorize with PKCE S256. The redirect is not followed: the caller reads `Location`. */
export function authorize(send: Send, base: string, options: AuthorizeOptions): Promise<Response> {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId,
    redirect_uri: options.redirectUri ?? REDIRECT_URI,
    scope: options.scope,
    state: STATE,
    code_challenge: PKCE_CHALLENGE,
    code_challenge_method: 'S256',
  })
  if (options.resource !== null) query.set('resource', options.resource)
  return send(`${base}/authorize?${query.toString()}`, { redirect: 'manual' })
}

/** The `code` of the redirect an approved /authorize answers with. */
export function codeOf(response: Response): string {
  const location = response.headers.get('Location')
  if (response.status !== 302 || location === null)
    throw new Error(`expected a redirect, got ${response.status}`)
  const code = new URL(location).searchParams.get('code')
  if (code === null) throw new Error(`no code in ${location}`)
  return code
}

/** POST to the token endpoint, form-encoded as RFC 6749 requires. */
export function tokenRequest(
  send: Send,
  base: string,
  form: Record<string, string>,
): Promise<Response> {
  return send(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })
}

export interface SignedIn {
  client: RegisteredClient
  tokens: TokenResponse
}

export interface SignInOptions {
  scope: string
  /** The `resource` the client names; null leaves it out. */
  resource: string | null
}

/** Registers a client, authorizes it (auto-approved) and exchanges the code: what an MCP client does. */
export async function signIn(send: Send, base: string, options: SignInOptions): Promise<SignedIn> {
  const client = await register(send, base)
  const approved = await authorize(send, base, {
    clientId: client.client_id,
    scope: options.scope,
    resource: options.resource,
  })
  const form: Record<string, string> = {
    grant_type: 'authorization_code',
    code: codeOf(approved),
    redirect_uri: REDIRECT_URI,
    client_id: client.client_id,
    code_verifier: PKCE_VERIFIER,
  }
  if (options.resource !== null) form.resource = options.resource
  const exchanged = await tokenRequest(send, base, form)
  if (exchanged.status !== 200) throw new Error(`token endpoint answered ${exchanged.status}`)
  return { client, tokens: await exchanged.json<TokenResponse>() }
}

export function bearer(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } }
}

/** A response reduced to what a client sees: status, the headers that matter and the body text. */
export async function wire(response: Response): Promise<{
  status: number
  wwwAuthenticate: string | null
  cacheControl: string | null
  body: string
}> {
  return {
    status: response.status,
    wwwAuthenticate: response.headers.get('WWW-Authenticate'),
    cacheControl: response.headers.get('Cache-Control'),
    body: await response.text(),
  }
}
