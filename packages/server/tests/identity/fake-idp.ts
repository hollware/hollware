export type Algorithm = 'RS256' | 'ES256'

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function encoded(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)))
}

export interface SigningKey {
  readonly kid: string
  readonly alg: Algorithm
  readonly jwk: Record<string, unknown>
  sign(claims: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>
}

export async function signingKey(alg: Algorithm = 'RS256'): Promise<SigningKey> {
  const pair = await crypto.subtle.generateKey(
    alg === 'RS256'
      ? {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        }
      : { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  if (!('privateKey' in pair)) throw new Error('the key pair was not generated')
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey)
  if (exported instanceof ArrayBuffer) throw new Error('the public key did not export as a JWK')
  const kid = crypto.randomUUID()
  return {
    kid,
    alg,
    jwk: { ...exported, kid, alg, use: 'sig' },
    sign: async (claims, header = {}) => {
      const head = encoded({ alg, kid, typ: 'JWT', ...header })
      const body = encoded(claims)
      const signature = await crypto.subtle.sign(
        alg === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' },
        pair.privateKey,
        new TextEncoder().encode(`${head}.${body}`),
      )
      return `${head}.${body}.${base64url(new Uint8Array(signature))}`
    },
  }
}
