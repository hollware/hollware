const PREFIX = 'v2.'
const BEFORE_PLACES = 'v1.'

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

export function newWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `whsec_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
