/**
 * The preview token: a signed, stateless proof that a person of a site may read the
 * latest revision of one entry, for one hour. A site that reads published content only (the
 * binding of RPC, the read API) reads that entry's head instead when it presents one.
 *
 *   hw_prv_<payload>.<signature>
 *
 * The payload is base64url of `{ "s": site, "e": entryId, "x": expiresAtSeconds }`, and the
 * signature the base64url HMAC-SHA256 of the payload text under a key that HKDF-SHA256 derives
 * from the Worker secret `HOLLWARE_SECRET`, bound to the site. Nothing is stored: a token cannot
 * be revoked, only wait out its hour, and rotating the secret ends every one.
 */

export const PREVIEW_TOKEN_PREFIX = 'hw_prv_'

/** The query parameter a site's page takes the token from. */
export const PREVIEW_QUERY_PARAM = 'hollware-preview'

/** How long a token lasts, in seconds. */
export const PREVIEW_TTL_SECONDS = 3600

/** The least characters of `HOLLWARE_SECRET` that Hollware signs anything with. */
export const PREVIEW_SECRET_MIN_LENGTH = 32

/** Why a token was not accepted: for the log of the operator, never for the caller. */
export type PreviewRefusal = 'no_secret' | 'malformed' | 'signature' | 'site' | 'expired'

export type PreviewCheck =
  | { readonly ok: true; readonly entryId: string; readonly expiresAt: string }
  | { readonly ok: false; readonly reason: PreviewRefusal }

/** Whether a Worker's secret can sign previews: present and long enough. */
export function canSignPreviews(secret: string | undefined): secret is string {
  return secret !== undefined && secret.length >= PREVIEW_SECRET_MIN_LENGTH
}

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

async function previewKey(secret: string, site: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode(`hollware preview\n${site}`),
    },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  )
}

/** A token for one entry of one site, valid for `PREVIEW_TTL_SECONDS` from `now`. */
export async function makePreviewToken(input: {
  readonly secret: string
  readonly site: string
  readonly entryId: string
  readonly now: Date
}): Promise<{ readonly token: string; readonly expiresAt: string }> {
  if (!canSignPreviews(input.secret)) {
    throw new Error(`HOLLWARE_SECRET must be at least ${PREVIEW_SECRET_MIN_LENGTH} characters.`)
  }
  const expires = Math.floor(input.now.getTime() / 1000) + PREVIEW_TTL_SECONDS
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ s: input.site, e: input.entryId, x: expires })),
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    await previewKey(input.secret, input.site),
    encoder.encode(payload),
  )
  return {
    token: `${PREVIEW_TOKEN_PREFIX}${payload}.${toBase64Url(new Uint8Array(mac))}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Checks a token for a site. The signature is verified (in constant time, by `crypto.subtle`)
 * before the payload is parsed, under the key of the site that is asked: a token made for another
 * site fails there. The entry the token names is the caller's to compare with the entry it read.
 */
export async function verifyPreviewToken(input: {
  readonly secret: string | undefined
  readonly site: string
  readonly token: string
  readonly now: Date
}): Promise<PreviewCheck> {
  if (!canSignPreviews(input.secret)) return { ok: false, reason: 'no_secret' }
  const { token } = input
  if (!token.startsWith(PREVIEW_TOKEN_PREFIX)) return { ok: false, reason: 'malformed' }
  const parts = token.slice(PREVIEW_TOKEN_PREFIX.length).split('.')
  const [payload, signature] = parts
  if (parts.length !== 2 || payload === undefined || signature === undefined) {
    return { ok: false, reason: 'malformed' }
  }
  const mac = fromBase64Url(signature)
  const body = fromBase64Url(payload)
  if (mac === null || body === null) return { ok: false, reason: 'malformed' }
  const signed = await crypto.subtle.verify(
    'HMAC',
    await previewKey(input.secret, input.site),
    mac,
    encoder.encode(payload),
  )
  if (!signed) return { ok: false, reason: 'signature' }
  let claims: unknown
  try {
    claims = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (
    !isRecord(claims) ||
    typeof claims['s'] !== 'string' ||
    typeof claims['e'] !== 'string' ||
    typeof claims['x'] !== 'number'
  ) {
    return { ok: false, reason: 'malformed' }
  }
  if (claims['s'] !== input.site) return { ok: false, reason: 'site' }
  if (Math.floor(input.now.getTime() / 1000) >= claims['x']) return { ok: false, reason: 'expired' }
  return {
    ok: true,
    entryId: claims['e'],
    expiresAt: new Date(claims['x'] * 1000).toISOString(),
  }
}
