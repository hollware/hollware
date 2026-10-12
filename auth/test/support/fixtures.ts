// Synthetic fixtures shared by the workerd tests, the Node scripts and the CPU benchmark.
// Nothing here is a real credential: the private key below is public on purpose.

import type { PrivateJwk } from './software-authenticator.ts'

export const RP_ID = 'cms.example.test'
export const RP_NAME = 'Hollware Spike'
export const ORIGIN = 'https://cms.example.test'
export const USER_NAME = 'owner@example.test'

/** `user.id`: the UTF-8 bytes of "user-0001". Never an email: it is stored on the authenticator. */
export const USER_ID = new Uint8Array(new TextEncoder().encode('user-0001'))
export const USER_ID_B64U = 'dXNlci0wMDAx'

/** 16 bytes, 0x01..0x10. */
export const CREDENTIAL_ID = Uint8Array.from({ length: 16 }, (_, index) => index + 1)
export const CREDENTIAL_ID_B64U = 'AQIDBAUGBwgJCgsMDQ4PEA'

/** 32 bytes, 0x00..0x1f, as base64url. */
export const CHALLENGE_BYTES = Uint8Array.from({ length: 32 }, (_, index) => index)
export const CHALLENGE_B64U = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'

/** A second, different challenge (0x20..0x3f). */
export const OTHER_CHALLENGE_BYTES = Uint8Array.from({ length: 32 }, (_, index) => 0x20 + index)
export const OTHER_CHALLENGE_B64U = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8'

/** SHA-256("cms.example.test"), computed once with `shasum -a 256`. */
export const RP_ID_HASH_HEX = 'bf2327df40afd4b64e60609fe2624df39e4517582cfe27e16b2b06b00f75bd28'

/** A fixed P-256 key pair, generated once with WebCrypto in Node 24 for this spike. */
export const ES256_PRIVATE_JWK: PrivateJwk = {
  kty: 'EC',
  crv: 'P-256',
  x: 'BO5xJ7xmBmBwnN4ZKbcBotUpkNRJPa3zYWLP9-TF1Tw',
  y: 'r7LwtB1almUyf_CIeaK8z9DPTeOyYo4v32VDDlEFVhM',
  d: 'm5ED1beWUMwVBzw_xnxJaiHOXfGzeAyGMitr8vn0XRo',
}

/**
 * The COSE_Key of that public key, written by hand from RFC 9052 and the key bytes above:
 * a5 (map of 5) | 01 02 (kty: EC2) | 03 26 (alg: -7) | 20 01 (crv: P-256) |
 * 21 58 20 <x> (x: 32 bytes) | 22 58 20 <y> (y: 32 bytes).
 */
export const ES256_COSE_PUBLIC_KEY_HEX =
  'a501020326200121582004ee7127bc660660709cde1929b701a2d52990d4493dadf36162cff7e4c5d53c' +
  '225820afb2f0b41d5a9665327ff08879a2bccfd0cf4de3b2628e2fdf65430e51055613'

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/** base64url without padding, like WebAuthn JSON: independent of the library's own helper. */
export const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

export const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

/** The message of what a promise rejects with, and the name of the error class. */
export async function rejection(
  promise: Promise<unknown>,
): Promise<{ name: string; message: string }> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) return { name: error.name, message: error.message }
    throw new Error(`Rejected with a non-Error: ${String(error)}`, { cause: error })
  }
  throw new Error('The promise resolved, a rejection was expected')
}
