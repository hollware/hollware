/**
 * Personal tokens (ADR-019): `hw_pat_` and 52 characters of lowercase Crockford base 32, which
 * carry 260 random bits. The CLI makes a token and prints it once. The server never stores it:
 * it keeps the SHA-256 of the whole token, in hex, and finds a presented token by that hash. The
 * row of a token has an id of its own (`tok_…`, see `ids.ts`), its scopes and its expiry.
 */

export const PERSONAL_TOKEN_PREFIX = 'hw_pat_'

/** Days until a new personal token expires, unless whoever creates it asks for another expiry. */
export const PERSONAL_TOKEN_TTL_DAYS = 90

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const SECRET_LENGTH = 52
const TOKEN_PATTERN = /^hw_pat_[0-9a-hjkmnp-tv-z]{52}$/

/**
 * A new personal token. Each of the 52 random bytes gives one character (its low 5 bits, which
 * are uniform because 256 is a multiple of 32). `random` defaults to `crypto.getRandomValues`;
 * tests pass their own bytes.
 */
export function generatePersonalToken(
  random: Uint8Array = crypto.getRandomValues(new Uint8Array(SECRET_LENGTH)),
): string {
  if (random.length !== SECRET_LENGTH) {
    throw new RangeError(
      `a personal token takes ${SECRET_LENGTH} random bytes, got ${random.length}`,
    )
  }
  let secret = ''
  for (const byte of random) secret += ALPHABET.charAt(byte & 31)
  return PERSONAL_TOKEN_PREFIX + secret
}

/** Whether a string has the shape of a personal token. It says nothing about whether one exists. */
export function isPersonalToken(value: string): boolean {
  return TOKEN_PATTERN.test(value)
}

/** The SHA-256 of a token, in lowercase hex: what the `tokens` table stores and looks up. */
export async function hashPersonalToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
