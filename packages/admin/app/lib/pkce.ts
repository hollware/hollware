/** PKCE (RFC 7636, S256) and the random values of an authorization request. */

/** Bytes as base64url, without padding. */
export function base64url(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A random value of `bytes` bytes, as base64url: a code verifier or a state. */
export function randomValue(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** The S256 challenge of a verifier: base64url of its SHA-256. */
export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}
