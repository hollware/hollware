// A software WebAuthn authenticator for tests: no browser, no hardware, only Web APIs.
//
// It plays the part of the browser plus the authenticator. It takes the JSON options a Relying
// Party sends (what `generateRegistrationOptions` / `generateAuthenticationOptions` return) and
// answers with the JSON a browser's `PublicKeyCredential.toJSON()` would produce, so the answer
// goes straight into `verifyRegistrationResponse` / `verifyAuthenticationResponse`.
//
// What it implements (WebAuthn Level 3, https://www.w3.org/TR/webauthn-3/):
// - registration with attestation format "none" (section 8.7): `fmt: "none"`, empty `attStmt`;
// - assertion (section 6.3.3): signature over `authenticatorData || SHA-256(clientDataJSON)`;
// - authenticator data (section 6.1): rpIdHash, flags (UP, UV, BE, BS, AT), signCount, and the
//   attested credential data (AAGUID, credential id, COSE_Key);
// - ES256 (ECDSA P-256 + SHA-256, COSE alg -7), EdDSA (Ed25519, -8) and RS256 (-257) keys, and
//   the DER encoding WebAuthn expects for ECDSA (WebCrypto returns raw r || s);
// - the checks a browser does: the RP ID must be the origin's host or a parent domain, the
//   credential must be in `allowCredentials`, and not in `excludeCredentials`.
//
// What it does not implement: other attestation formats, extensions beyond `credProps`, user
// verification prompts, tokenBinding, topOrigin. It never refuses on user verification: it reports
// the UV flag it was built with, so a test can check what the Relying Party does with UV = 0.
//
// Everything is plain Web APIs (`crypto.subtle`, TextEncoder), so it runs in Node 24, in workerd
// and in a browser. The only runtime import is the CBOR / base64url helpers of
// `@simplewebauthn/server/helpers`; the hashes and signatures use WebCrypto directly, so a bug in
// the library's hashing cannot hide behind the same bug here.

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { cose, isoBase64URL, isoCBOR, isoUint8Array } from '@simplewebauthn/server/helpers'

/** The value type `isoCBOR.encode` accepts (the helpers do not export it by name). */
type CborValue = Parameters<typeof isoCBOR.encode>[0]

/**
 * The library types every byte string as `Uint8Array<ArrayBuffer>`, while the workers types give
 * `Uint8Array<ArrayBufferLike>` (`TextEncoder.encode`, `exportKey`...). `new Uint8Array(source)`
 * copies into the narrow type; this module uses it wherever a value crosses over.
 */
type Bytes = Uint8Array<ArrayBuffer>

/**
 * A WebCrypto key. Derived from the API instead of naming `CryptoKey`: under the workers types it
 * is a global type, under the Node types only a value, and this module is checked under both.
 */
type CryptoKeyHandle = Awaited<ReturnType<typeof crypto.subtle.importKey>>

export type AuthenticatorAlgorithm = 'ES256' | 'EdDSA' | 'RS256'

/** A private JWK: `d` for EC and OKP keys, `d`/`p`/`q`/`dp`/`dq`/`qi` for RSA. */
export type PrivateJwk = {
  kty: string
  crv?: string
  x?: string
  y?: string
  n?: string
  e?: string
  d?: string
  p?: string
  q?: string
  dp?: string
  dq?: string
  qi?: string
}

export type SoftwareAuthenticatorOptions = {
  /** The credential id the authenticator reports (16 to 1023 bytes; a real one is random). */
  credentialId: Bytes
  /** ES256 (default), EdDSA or RS256. The Relying Party must offer it in `pubKeyCredParams`. */
  algorithm?: AuthenticatorAlgorithm
  /** A fixed private key, to get the same public key on every run. Omit it to generate one. */
  privateJwk?: PrivateJwk
  /** 16 bytes. All zeros (the default) is what most platform authenticators report with "none". */
  aaguid?: Bytes
  /** The UV flag. Default `true`. */
  userVerified?: boolean
  /** The BE flag: the credential can be backed up (a synced passkey). Default `false`. */
  backupEligible?: boolean
  /** The BS flag: the credential is backed up right now. Needs `backupEligible`. Default `false`. */
  backedUp?: boolean
  /**
   * `increment` adds one on every assertion (a hardware key, Windows Hello). `zero` always reports
   * 0 (what synced passkeys do). Default `increment`.
   */
  signCountBehavior?: 'increment' | 'zero'
  /** The sign count the authenticator starts from. Default 0. */
  signCount?: number
  /** Reported on registration (`getTransports()`). Default `['internal']`. */
  transports?: string[]
}

export type CeremonyContext = {
  /** The origin the "browser" is on, like `https://cms.example.test`. */
  origin: string
  /** `clientDataJSON.crossOrigin`. Default `false`. */
  crossOrigin?: boolean
  /**
   * Add the extra key Chrome puts in clientDataJSON so that nobody compares it with a template
   * (`other_keys_can_be_added_here`). Default `false`.
   */
  greaseClientData?: boolean
}

const FLAG_UP = 0x01
const FLAG_UV = 0x04
const FLAG_BE = 0x08
const FLAG_BS = 0x10
const FLAG_AT = 0x40

const COSE_ALG: Record<AuthenticatorAlgorithm, number> = {
  ES256: cose.COSEALG.ES256,
  EdDSA: cose.COSEALG.EdDSA,
  RS256: cose.COSEALG.RS256,
}

const utf8 = (text: string): Bytes => new Uint8Array(new TextEncoder().encode(text))

const sha256 = async (data: Bytes): Promise<Bytes> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', data))

const uint16 = (value: number): Bytes => Uint8Array.of(value >> 8, value & 0xff)

const uint32 = (value: number): Bytes =>
  Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)

/**
 * WebCrypto signs ECDSA as raw `r || s` (IEEE P1363); WebAuthn wants the ASN.1 DER encoding:
 * SEQUENCE { INTEGER r, INTEGER s }. Each INTEGER is minimal (no leading zero bytes) and gets one
 * 0x00 in front when its first byte has the high bit set, so it stays positive.
 */
export function ecdsaRawToDer(raw: Bytes): Bytes {
  if (raw.length === 0 || raw.length % 2 !== 0) {
    throw new Error(`An ECDSA raw signature has an even, non-zero length, got ${raw.length}`)
  }
  const derInteger = (bytes: Bytes): Bytes => {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start++
    let value: Bytes = new Uint8Array(bytes.subarray(start))
    if ((value[0] ?? 0) & 0x80) value = isoUint8Array.concat([Uint8Array.of(0), value])
    return isoUint8Array.concat([Uint8Array.of(0x02, value.length), value])
  }
  const half = raw.length / 2
  const body = isoUint8Array.concat([
    derInteger(raw.subarray(0, half)),
    derInteger(raw.subarray(half)),
  ])
  // P-256: the body is at most 70 bytes, so the length always fits one byte. Long form beyond.
  const length = body.length < 0x80 ? Uint8Array.of(body.length) : Uint8Array.of(0x81, body.length)
  return isoUint8Array.concat([Uint8Array.of(0x30), length, body])
}

/** Like a browser: the RP ID must be the origin's host or a parent domain of it. */
function assertRpIdMatchesOrigin(rpId: string, origin: string): void {
  const host = new URL(origin).hostname
  if (host !== rpId && !host.endsWith(`.${rpId}`)) {
    throw new Error(
      `SecurityError: the RP ID "${rpId}" is not the host of the origin "${origin}" or a parent domain of it`,
    )
  }
}

type KeyMaterial = {
  privateKey: CryptoKeyHandle
  /** The public half as a JWK: `x`/`y` (EC), `x` (OKP) or `n`/`e` (RSA). */
  publicJwk: PrivateJwk
  /** The public key as SPKI, what `AuthenticatorAttestationResponse.getPublicKey()` returns. */
  spki: Bytes
}

const ALGORITHMS = {
  ES256: {
    generate: { name: 'ECDSA', namedCurve: 'P-256' },
    importParams: { name: 'ECDSA', namedCurve: 'P-256' },
    sign: { name: 'ECDSA', hash: 'SHA-256' },
  },
  EdDSA: {
    generate: { name: 'Ed25519' },
    importParams: { name: 'Ed25519' },
    sign: { name: 'Ed25519' },
  },
  RS256: {
    generate: {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
      modulusLength: 2048,
      publicExponent: Uint8Array.of(1, 0, 1),
    },
    importParams: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    sign: { name: 'RSASSA-PKCS1-v1_5' },
  },
} as const

/** The public fields of a JWK, without `d` and the RSA private parameters. */
function publicPart(jwk: PrivateJwk): PrivateJwk {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, n: jwk.n, e: jwk.e }
}

/** `exportKey` types its answer as ArrayBuffer | JsonWebKey; each format gives one of them. */
async function exportJwk(key: CryptoKeyHandle): Promise<PrivateJwk> {
  const exported = await crypto.subtle.exportKey('jwk', key)
  if (exported instanceof ArrayBuffer || exported.kty === undefined) {
    throw new Error('exportKey("jwk") did not return a JWK')
  }
  return { ...exported, kty: exported.kty }
}

async function exportSpki(key: CryptoKeyHandle): Promise<Bytes> {
  const exported = await crypto.subtle.exportKey('spki', key)
  if (!(exported instanceof ArrayBuffer)) throw new Error('exportKey("spki") did not return bytes')
  return new Uint8Array(exported)
}

async function loadKeys(
  algorithm: AuthenticatorAlgorithm,
  privateJwk: PrivateJwk | undefined,
): Promise<KeyMaterial> {
  const spec = ALGORITHMS[algorithm]
  if (privateJwk === undefined) {
    const pair = await crypto.subtle.generateKey(spec.generate, true, ['sign', 'verify'])
    if (!('privateKey' in pair)) throw new Error('generateKey did not return a key pair')
    return {
      privateKey: pair.privateKey,
      publicJwk: publicPart(await exportJwk(pair.publicKey)),
      spki: await exportSpki(pair.publicKey),
    }
  }
  // A private key cannot give its public half back, so import the public half from the same JWK.
  const publicJwk = publicPart(privateJwk)
  const publicKey = await crypto.subtle.importKey('jwk', publicJwk, spec.importParams, true, [
    'verify',
  ])
  return {
    privateKey: await crypto.subtle.importKey('jwk', privateJwk, spec.importParams, false, [
      'sign',
    ]),
    publicJwk,
    spki: await exportSpki(publicKey),
  }
}

/** The COSE_Key (RFC 9052 section 7) bytes for the public key, in CTAP2 canonical key order. */
function encodeCosePublicKey(algorithm: AuthenticatorAlgorithm, jwk: PrivateJwk): Bytes {
  const bytes = (value: string | undefined, name: string): Bytes => {
    if (value === undefined) throw new Error(`The public JWK has no "${name}"`)
    return isoBase64URL.toBuffer(value)
  }
  const key = new Map<string | number, CborValue>()
  if (algorithm === 'ES256') {
    key.set(cose.COSEKEYS.kty, cose.COSEKTY.EC2)
    key.set(cose.COSEKEYS.alg, cose.COSEALG.ES256)
    key.set(cose.COSEKEYS.crv, cose.COSECRV.P256)
    key.set(cose.COSEKEYS.x, bytes(jwk.x, 'x'))
    key.set(cose.COSEKEYS.y, bytes(jwk.y, 'y'))
  } else if (algorithm === 'EdDSA') {
    key.set(cose.COSEKEYS.kty, cose.COSEKTY.OKP)
    key.set(cose.COSEKEYS.alg, cose.COSEALG.EdDSA)
    key.set(cose.COSEKEYS.crv, cose.COSECRV.ED25519)
    key.set(cose.COSEKEYS.x, bytes(jwk.x, 'x'))
  } else {
    key.set(cose.COSEKEYS.kty, cose.COSEKTY.RSA)
    key.set(cose.COSEKEYS.alg, cose.COSEALG.RS256)
    key.set(cose.COSEKEYS.n, bytes(jwk.n, 'n'))
    key.set(cose.COSEKEYS.e, bytes(jwk.e, 'e'))
  }
  return isoCBOR.encode(key)
}

export class SoftwareAuthenticator {
  readonly credentialId: Bytes
  readonly algorithm: AuthenticatorAlgorithm
  readonly signCountBehavior: 'increment' | 'zero'
  /** The public key exactly as the Relying Party stores it: the COSE_Key bytes. */
  readonly cosePublicKey: Bytes
  /** The public key as SPKI. */
  readonly spki: Bytes
  /** The counter the authenticator reports in its latest signed authenticator data. */
  signCount: number
  /** `user.id` of the last registration, handed back as `userHandle` on assertions. */
  userHandle: Bytes | undefined

  readonly #privateKey: CryptoKeyHandle
  readonly #aaguid: Bytes
  readonly #flags: number
  readonly #transports: string[]

  private constructor(options: {
    credentialId: Bytes
    algorithm: AuthenticatorAlgorithm
    keys: KeyMaterial
    aaguid: Bytes
    flags: number
    signCount: number
    signCountBehavior: 'increment' | 'zero'
    transports: string[]
  }) {
    this.credentialId = options.credentialId
    this.algorithm = options.algorithm
    this.signCountBehavior = options.signCountBehavior
    this.cosePublicKey = encodeCosePublicKey(options.algorithm, options.keys.publicJwk)
    this.spki = options.keys.spki
    this.signCount = options.signCount
    this.userHandle = undefined
    this.#privateKey = options.keys.privateKey
    this.#aaguid = options.aaguid
    this.#flags = options.flags
    this.#transports = options.transports
  }

  static async create(options: SoftwareAuthenticatorOptions): Promise<SoftwareAuthenticator> {
    const algorithm = options.algorithm ?? 'ES256'
    const aaguid = options.aaguid ?? new Uint8Array(16)
    if (aaguid.length !== 16) throw new Error(`The AAGUID has 16 bytes, got ${aaguid.length}`)
    if (options.backedUp && !options.backupEligible) {
      throw new Error('BS without BE is invalid: a single-device credential cannot be backed up')
    }
    let flags = FLAG_UP
    if (options.userVerified ?? true) flags |= FLAG_UV
    if (options.backupEligible) flags |= FLAG_BE
    if (options.backedUp) flags |= FLAG_BS
    return new SoftwareAuthenticator({
      credentialId: options.credentialId,
      algorithm,
      keys: await loadKeys(algorithm, options.privateJwk),
      aaguid,
      flags,
      signCount: options.signCount ?? 0,
      signCountBehavior: options.signCountBehavior ?? 'increment',
      transports: options.transports ?? ['internal'],
    })
  }

  /** `navigator.credentials.create()`: makes the credential and answers like `toJSON()`. */
  async createCredential(
    options: PublicKeyCredentialCreationOptionsJSON,
    context: CeremonyContext,
  ): Promise<RegistrationResponseJSON> {
    const rpId = options.rp.id ?? new URL(context.origin).hostname
    assertRpIdMatchesOrigin(rpId, context.origin)
    const alg = COSE_ALG[this.algorithm]
    if (!options.pubKeyCredParams.some((param) => param.alg === alg)) {
      const offered = options.pubKeyCredParams.map((param) => param.alg).join(', ')
      throw new Error(`NotSupportedError: ${this.algorithm} (${alg}) is not in [${offered}]`)
    }
    const id = isoBase64URL.fromBuffer(this.credentialId)
    if (options.excludeCredentials?.some((credential) => credential.id === id)) {
      throw new Error(`InvalidStateError: the credential "${id}" is in excludeCredentials`)
    }
    this.userHandle = isoBase64URL.toBuffer(options.user.id)

    const clientDataJSON = clientData('webauthn.create', options.challenge, context)
    // Attested credential data: AAGUID (16) | credential id length (2, big endian) | id | COSE_Key.
    const attestedCredentialData = isoUint8Array.concat([
      this.#aaguid,
      uint16(this.credentialId.length),
      this.credentialId,
      this.cosePublicKey,
    ])
    const authenticatorData = isoUint8Array.concat([
      await sha256(utf8(rpId)),
      Uint8Array.of(this.#flags | FLAG_AT),
      uint32(this.signCount),
      attestedCredentialData,
    ])
    // Attestation object (section 6.5): the keys in CTAP2 canonical order, "none" has an empty map.
    const attestationObject = isoCBOR.encode(
      new Map<string | number, CborValue>([
        ['fmt', 'none'],
        ['attStmt', new Map<string | number, CborValue>()],
        ['authData', authenticatorData],
      ]),
    )

    return {
      id,
      rawId: id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: { credProps: { rk: true } },
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
        transports: this.#transports,
        publicKeyAlgorithm: alg,
        publicKey: isoBase64URL.fromBuffer(this.spki),
      },
    }
  }

  /** `navigator.credentials.get()`: signs the challenge and answers like `toJSON()`. */
  async getAssertion(
    options: PublicKeyCredentialRequestOptionsJSON,
    context: CeremonyContext,
  ): Promise<AuthenticationResponseJSON> {
    const rpId = options.rpId ?? new URL(context.origin).hostname
    assertRpIdMatchesOrigin(rpId, context.origin)
    const id = isoBase64URL.fromBuffer(this.credentialId)
    const allowed = options.allowCredentials ?? []
    if (allowed.length > 0 && !allowed.some((credential) => credential.id === id)) {
      throw new Error(`NotAllowedError: the credential "${id}" is not in allowCredentials`)
    }

    if (this.signCountBehavior === 'increment') this.signCount += 1
    const clientDataJSON = clientData('webauthn.get', options.challenge, context)
    // Authenticator data of an assertion: rpIdHash | flags | signCount. No attested credential data.
    const authenticatorData = isoUint8Array.concat([
      await sha256(utf8(rpId)),
      Uint8Array.of(this.#flags),
      uint32(this.signCountBehavior === 'zero' ? 0 : this.signCount),
    ])
    const signedData = isoUint8Array.concat([authenticatorData, await sha256(clientDataJSON)])
    const rawSignature = new Uint8Array(
      await crypto.subtle.sign(ALGORITHMS[this.algorithm].sign, this.#privateKey, signedData),
    )
    // ECDSA needs DER; Ed25519 and RSASSA-PKCS1-v1_5 signatures go as WebCrypto returns them.
    const signature = this.algorithm === 'ES256' ? ecdsaRawToDer(rawSignature) : rawSignature

    return {
      id,
      rawId: id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientDataJSON),
        authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
        signature: isoBase64URL.fromBuffer(signature),
        ...(this.userHandle === undefined
          ? {}
          : { userHandle: isoBase64URL.fromBuffer(this.userHandle) }),
      },
    }
  }
}

/** The collected client data. The field order and shape are what Chrome and Firefox send today. */
function clientData(
  type: 'webauthn.create' | 'webauthn.get',
  challenge: string,
  context: CeremonyContext,
): Bytes {
  return utf8(
    JSON.stringify({
      type,
      challenge,
      origin: context.origin,
      crossOrigin: context.crossOrigin ?? false,
      ...(context.greaseClientData
        ? {
            other_keys_can_be_added_here:
              'do not compare clientDataJSON against a template. See https://goo.gl/yabPex',
          }
        : {}),
    }),
  )
}
