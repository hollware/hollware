/**
 * A software authenticator for the tests of the passkey ceremonies: an ES256 key pair made with
 * Web Crypto, and the CBOR and the signatures of WebAuthn built by hand, so that registration and
 * sign-in run through SimpleWebAuthn's real verification. It answers with what a browser's
 * `credential.toJSON()` gives: attestation `none`, user present and verified.
 */

type Cbor = number | string | Uint8Array | Cbor[] | Map<Cbor, Cbor>

function head(major: number, length: number): number[] {
  if (length < 24) return [(major << 5) | length]
  if (length < 256) return [(major << 5) | 24, length]
  return [(major << 5) | 25, length >> 8, length & 0xff]
}

function cbor(value: Cbor): number[] {
  if (typeof value === 'number') {
    return value >= 0 ? head(0, value) : head(1, -1 - value)
  }
  if (typeof value === 'string') {
    const bytes = [...new TextEncoder().encode(value)]
    return [...head(3, bytes.length), ...bytes]
  }
  if (value instanceof Uint8Array) return [...head(2, value.length), ...value]
  if (Array.isArray(value)) return [...head(4, value.length), ...value.flatMap(cbor)]
  return [
    ...head(5, value.size),
    ...[...value].flatMap(([key, item]) => [...cbor(key), ...cbor(item)]),
  ]
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** A raw ECDSA signature (r and s, 32 bytes each) as WebAuthn wants it: DER. */
function der(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array) => {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start++
    const trimmed = bytes.slice(start)
    const body = (trimmed[0] ?? 0) & 0x80 ? concat(new Uint8Array([0]), trimmed) : trimmed
    return concat(new Uint8Array([0x02, body.length]), body)
  }
  const sequence = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)))
  return concat(new Uint8Array([0x30, sequence.length]), sequence)
}

const UP = 0x01
const UV = 0x04
const AT = 0x40

export interface SoftPasskey {
  readonly credentialId: string
  readonly userHandle: string
}

export async function softAuthenticator(origin: string) {
  const rpId = new URL(origin).hostname
  const generated = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  if (!('publicKey' in generated)) throw new Error('ECDSA gave no key pair')
  const keys = generated
  const credential = crypto.getRandomValues(new Uint8Array(16))
  const credentialId = base64url(credential)
  let counter = 0
  let handle = ''

  async function authData(flags: number, attested: Uint8Array | null): Promise<Uint8Array> {
    const count = new Uint8Array(4)
    new DataView(count.buffer).setUint32(0, counter)
    return concat(
      await sha256(new TextEncoder().encode(rpId)),
      new Uint8Array([flags]),
      count,
      attested ?? new Uint8Array(),
    )
  }

  function clientData(type: string, challenge: string, from: string): Uint8Array {
    return new TextEncoder().encode(
      JSON.stringify({ type, challenge, origin: from, crossOrigin: false }),
    )
  }

  return {
    credentialId,
    /** What `navigator.credentials.create(options).toJSON()` gives. */
    async register(options: { challenge: string; user: { id: string } }, from = origin) {
      handle = options.user.id
      const exported = await crypto.subtle.exportKey('jwk', keys.publicKey)
      if (exported instanceof ArrayBuffer) throw new Error('the public key did not export as a JWK')
      const jwk = exported
      const decode = (text: string | undefined = '') =>
        Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
      const cose = new Uint8Array(
        cbor(
          new Map<Cbor, Cbor>([
            [1, 2],
            [3, -7],
            [-1, 1],
            [-2, decode(jwk.x)],
            [-3, decode(jwk.y)],
          ]),
        ),
      )
      const length = new Uint8Array([credential.length >> 8, credential.length & 0xff])
      const attested = concat(new Uint8Array(16), length, credential, cose)
      const data = await authData(UP | UV | AT, attested)
      const attestation = new Uint8Array(
        cbor(
          new Map<Cbor, Cbor>([
            ['fmt', 'none'],
            ['attStmt', new Map()],
            ['authData', data],
          ]),
        ),
      )
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key' as const,
        response: {
          clientDataJSON: base64url(clientData('webauthn.create', options.challenge, from)),
          attestationObject: base64url(attestation),
          transports: ['internal' as const],
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform' as const,
      }
    },
    /** What `navigator.credentials.get(options).toJSON()` gives. */
    async authenticate(options: { challenge: string }, from = origin) {
      counter += 1
      const data = await authData(UP | UV, null)
      const client = clientData('webauthn.get', options.challenge, from)
      const signed = concat(data, await sha256(client))
      const raw = new Uint8Array(
        await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, signed),
      )
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key' as const,
        response: {
          clientDataJSON: base64url(client),
          authenticatorData: base64url(data),
          signature: base64url(der(raw)),
          userHandle: handle,
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform' as const,
      }
    },
  }
}
