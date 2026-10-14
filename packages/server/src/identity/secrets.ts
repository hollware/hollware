/**
 * The secrets of identity (ADR-026): an invitation link and a session cookie are 32 random bytes,
 * base64url, with a prefix that says what they are. Only the SHA-256 of a secret is stored.
 */

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A new secret: `<prefix>_` and 43 base64url characters. */
export function newSecret(prefix: 'hw_inv' | 'hw_ses'): string {
  return `${prefix}_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`
}

/** The SHA-256 of a secret, in hex: what the database keeps. */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The bytes of a user id, as WebAuthn binds a passkey to them. */
export function userHandle(userId: string): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(userId)
  const handle = new Uint8Array(bytes.length)
  handle.set(bytes)
  return handle
}
