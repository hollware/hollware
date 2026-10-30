export type Fetcher = (request: Request) => Promise<Response>

export class TokenRefused extends Error {
  override readonly name = 'TokenRefused'
}

export const CLOCK_SKEW_SECONDS = 60

const KEYS_TTL_MS = 3_600_000

const ALGORITHMS = {
  RS256: {
    import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    verify: { name: 'RSASSA-PKCS1-v1_5' },
    kty: 'RSA',
  },
  ES256: {
    import: { name: 'ECDSA', namedCurve: 'P-256' },
    verify: { name: 'ECDSA', hash: 'SHA-256' },
    kty: 'EC',
  },
} as const

type Algorithm = keyof typeof ALGORITHMS

function isAlgorithm(value: unknown): value is Algorithm {
  return value === 'RS256' || value === 'ES256'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bytesOf(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at)
  return bytes
}

function jsonOf(part: string): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytesOf(part)))
  if (!isRecord(value)) throw new TokenRefused('a part of the token is not a JSON object')
  return value
}

interface KeySet {
  readonly keys: readonly Record<string, unknown>[]
  readonly at: number
}

const keySets = new Map<string, KeySet>()
const documents = new Map<
  string,
  { readonly value: Record<string, unknown>; readonly at: number }
>()

async function fetchJson(fetcher: Fetcher, url: string): Promise<Record<string, unknown>> {
  const response = await fetcher(new Request(url, { headers: { accept: 'application/json' } }))
  if (!response.ok) throw new TokenRefused(`${url} answered ${response.status}`)
  const value: unknown = await response.json()
  if (!isRecord(value)) throw new TokenRefused(`${url} answered no JSON object`)
  return value
}

async function keysAt(fetcher: Fetcher, url: string, now: number, fresh: boolean) {
  const known = keySets.get(url)
  if (!fresh && known !== undefined && now - known.at < KEYS_TTL_MS) return known.keys
  const body = await fetchJson(fetcher, url)
  const listed: unknown = body['keys']
  const keys = Array.isArray(listed) ? listed.filter(isRecord) : []
  keySets.set(url, { keys, at: now })
  return keys
}

function asJwk(key: Record<string, unknown>): JsonWebKey {
  const kty = key['kty']
  const jwk: JsonWebKey = { kty: typeof kty === 'string' ? kty : '' }
  for (const name of ['n', 'e', 'crv', 'x', 'y'] as const) {
    const value = key[name]
    if (typeof value === 'string') jwk[name] = value
  }
  return jwk
}

async function keyFor(
  fetcher: Fetcher,
  url: string,
  kid: string,
  algorithm: Algorithm,
  now: number,
): Promise<JsonWebKey> {
  const pick = (keys: readonly Record<string, unknown>[]) =>
    keys.find((key) => key['kid'] === kid && key['kty'] === ALGORITHMS[algorithm].kty)
  const cached = pick(await keysAt(fetcher, url, now, false))
  if (cached !== undefined) return asJwk(cached)
  const fetched = pick(await keysAt(fetcher, url, now, true))
  if (fetched === undefined) throw new TokenRefused(`no key ${kid} at ${url}`)
  return asJwk(fetched)
}

export async function discover(
  fetcher: Fetcher,
  issuer: string,
  now: number,
): Promise<Record<string, unknown>> {
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  const known = documents.get(url)
  if (known !== undefined && now - known.at < KEYS_TTL_MS) return known.value
  const value = await fetchJson(fetcher, url)
  documents.set(url, { value, at: now })
  return value
}

export interface Expected {
  readonly keys: string
  readonly issuers: readonly string[]
  readonly audience: string
  readonly nonce: string | null
  readonly now: Date
}

function hasAudience(claim: unknown, audience: string): boolean {
  if (typeof claim === 'string') return claim === audience
  return Array.isArray(claim) && claim.includes(audience)
}

function seconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function verifyJwt(
  fetcher: Fetcher,
  token: string,
  expected: Expected,
): Promise<Record<string, unknown>> {
  const parts = token.split('.')
  const [head, body, signature] = parts
  if (parts.length !== 3 || head === undefined || body === undefined || signature === undefined) {
    throw new TokenRefused('the token is not a signed JWT')
  }
  const header = jsonOf(head)
  const algorithm = header['alg']
  const kid = header['kid']
  if (!isAlgorithm(algorithm)) throw new TokenRefused(`the algorithm ${String(algorithm)}`)
  if (typeof kid !== 'string') throw new TokenRefused('the token names no key')
  const now = expected.now.getTime()
  const jwk = await keyFor(fetcher, expected.keys, kid, algorithm, now)
  const key = await crypto.subtle.importKey('jwk', jwk, ALGORITHMS[algorithm].import, false, [
    'verify',
  ])
  const signed = new TextEncoder().encode(`${head}.${body}`)
  const valid = await crypto.subtle.verify(
    ALGORITHMS[algorithm].verify,
    key,
    bytesOf(signature),
    signed,
  )
  if (!valid) throw new TokenRefused('the signature does not verify')
  const claims = jsonOf(body)
  const issuer = claims['iss']
  if (typeof issuer !== 'string' || !expected.issuers.includes(issuer)) {
    throw new TokenRefused(`the issuer ${String(issuer)}`)
  }
  if (!hasAudience(claims['aud'], expected.audience)) {
    throw new TokenRefused('the token is for another audience')
  }
  const at = now / 1000
  const expires = seconds(claims['exp'])
  if (expires === null || at >= expires + CLOCK_SKEW_SECONDS) {
    throw new TokenRefused('the token expired')
  }
  const notBefore = seconds(claims['nbf'])
  if (notBefore !== null && at < notBefore - CLOCK_SKEW_SECONDS) {
    throw new TokenRefused('the token is not valid yet')
  }
  if (expected.nonce !== null && claims['nonce'] !== expected.nonce) {
    throw new TokenRefused('the nonce is not the one of this sign-in')
  }
  return claims
}
