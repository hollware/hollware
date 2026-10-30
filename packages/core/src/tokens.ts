export const PERSONAL_TOKEN_PREFIX = 'hw_pat_'

export const READ_TOKEN_PREFIX = 'hw_read_'

export const AGENT_GRANT_PREFIX = 'hw_agt_'

/** Minutes an agent's grant lasts, from the delivery that carries it. */
export const AGENT_GRANT_TTL_MINUTES = 60

/** Days until a new personal token expires, unless whoever creates it asks for another expiry. */
export const PERSONAL_TOKEN_TTL_DAYS = 90

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const SECRET_LENGTH = 52
const TOKEN_PATTERN = /^hw_pat_[0-9a-hjkmnp-tv-z]{52}$/
const READ_TOKEN_PATTERN = /^hw_read_[0-9a-hjkmnp-tv-z]{52}$/
const AGENT_GRANT_PATTERN = /^hw_agt_[0-9a-hjkmnp-tv-z]{52}$/

/**
 * A new personal token. Each of the 52 random bytes gives one character (its low 5 bits, which
 * are uniform because 256 is a multiple of 32). `random` defaults to `crypto.getRandomValues`;
 * tests pass their own bytes.
 */
export function generatePersonalToken(
  random: Uint8Array = crypto.getRandomValues(new Uint8Array(SECRET_LENGTH)),
): string {
  return PERSONAL_TOKEN_PREFIX + secretOf(random, 'a personal token')
}

/** A new read token, made as a personal token is. */
export function generateReadToken(
  random: Uint8Array = crypto.getRandomValues(new Uint8Array(SECRET_LENGTH)),
): string {
  return READ_TOKEN_PREFIX + secretOf(random, 'a read token')
}

/** A new grant of an agent, made as a personal token is. */
export function generateAgentGrant(
  random: Uint8Array = crypto.getRandomValues(new Uint8Array(SECRET_LENGTH)),
): string {
  return AGENT_GRANT_PREFIX + secretOf(random, 'an agent grant')
}

function secretOf(random: Uint8Array, what: string): string {
  if (random.length !== SECRET_LENGTH) {
    throw new RangeError(`${what} takes ${SECRET_LENGTH} random bytes, got ${random.length}`)
  }
  let secret = ''
  for (const byte of random) secret += ALPHABET.charAt(byte & 31)
  return secret
}

/** Whether a string has the shape of a personal token. It says nothing about whether one exists. */
export function isPersonalToken(value: string): boolean {
  return TOKEN_PATTERN.test(value)
}

/** Whether a string has the shape of a read token. It says nothing about whether one exists. */
export function isReadToken(value: string): boolean {
  return READ_TOKEN_PATTERN.test(value)
}

/** Whether a string has the shape of an agent's grant. It says nothing about whether one exists. */
export function isAgentGrant(value: string): boolean {
  return AGENT_GRANT_PATTERN.test(value)
}

/** The SHA-256 of a token, in lowercase hex: what the `tokens` table stores and looks up. */
export async function hashPersonalToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
