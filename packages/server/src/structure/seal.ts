/**
 * Sealing a secret of the structure (ADR-033) under the Worker secret `HOLLWARE_SECRET`, so that
 * the database alone never holds one in clear: AES-GCM with a 256-bit key that is the SHA-256 of
 * that secret, and a fresh 96-bit nonce each time. What is stored is `v2.` and the base64url of
 * the nonce and the ciphertext with its tag, sealed with the site and the name of the secret as
 * associated data: a value moved to another row of D1 does not open there (T-71 of the threat
 * model). One that was tampered with, or sealed under another `HOLLWARE_SECRET`, does not open.
 * A `v1.` value, sealed before the place was bound, still opens wherever it is.
 */

const PREFIX = 'v2.'
const BEFORE_PLACES = 'v1.'

/** Where a sealed secret belongs: the site and the name it is stored under. */
export interface Place {
  readonly site: string
  readonly name: string
}

const placeOf = (place: Place) => new TextEncoder().encode(`${place.site}\n${place.name}`)

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromBase64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)), (c) =>
    c.charCodeAt(0),
  )
}

async function keyOf(master: string): Promise<CryptoKey> {
  if (master.length < 32) {
    throw new Error('HOLLWARE_SECRET is shorter than 32 characters: hollware deploy makes one')
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(master))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function seal(master: string, value: string, place: Place): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: placeOf(place) },
      await keyOf(master),
      new TextEncoder().encode(value),
    ),
  )
  const sealed = new Uint8Array(nonce.length + cipher.length)
  sealed.set(nonce)
  sealed.set(cipher, nonce.length)
  return `${PREFIX}${base64url(sealed)}`
}

/** The value of a sealed secret, or `null` when it does not open under `master` at `place`. */
export async function unseal(master: string, sealed: string, place: Place): Promise<string | null> {
  const bound = sealed.startsWith(PREFIX)
  if (!bound && !sealed.startsWith(BEFORE_PLACES)) return null
  try {
    const bytes = fromBase64url(sealed.slice(PREFIX.length))
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytes.slice(0, 12),
        ...(bound ? { additionalData: placeOf(place) } : {}),
      },
      await keyOf(master),
      bytes.slice(12),
    )
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

/**
 * Opens a sealed secret, as `unseal` does, and hands a `v1.` value that opened to `rewrite` sealed
 * again as `v2.`, bound to its place: the values of 0.8 to 0.10 leave the database as they are
 * read, so moving one between rows stops working for them too (T-71).
 */
export async function openSealed(
  master: string,
  sealed: string,
  place: Place,
  rewrite: (resealed: string) => Promise<void>,
): Promise<string | null> {
  const value = await unseal(master, sealed, place)
  if (value !== null && sealed.startsWith(BEFORE_PLACES)) {
    await rewrite(await seal(master, value, place))
  }
  return value
}

/** A new secret for a webhook: 32 random bytes, hex, behind `whsec_`. */
export function newWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `whsec_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
