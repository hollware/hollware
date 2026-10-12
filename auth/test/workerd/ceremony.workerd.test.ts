import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { COSEALG } from '@simplewebauthn/server/helpers'
import { describe, expect, it } from 'vitest'
import {
  CHALLENGE_B64U,
  CHALLENGE_BYTES,
  CREDENTIAL_ID,
  CREDENTIAL_ID_B64U,
  ES256_COSE_PUBLIC_KEY_HEX,
  ES256_PRIVATE_JWK,
  ORIGIN,
  OTHER_CHALLENGE_B64U,
  OTHER_CHALLENGE_BYTES,
  RP_ID,
  RP_ID_HASH_HEX,
  RP_NAME,
  USER_ID,
  USER_ID_B64U,
  USER_NAME,
  fromBase64Url,
  toHex,
} from '../support/fixtures.ts'
import { registerFixturePasskey } from '../support/ceremony.ts'
import { SoftwareAuthenticator } from '../support/software-authenticator.ts'

// S5a. A whole passkey ceremony with @simplewebauthn/server 14.0.3, in workerd:
// generateRegistrationOptions -> software authenticator -> verifyRegistrationResponse ->
// generateAuthenticationOptions -> software assertion -> verifyAuthenticationResponse.
//
// Fails when: the library stops working on workerd's WebCrypto (digest, importKey, verify), a
// dependency of it starts needing something workerd lacks, the software authenticator writes
// authenticator data, a COSE key or a DER signature the library cannot read, or the library stops
// returning the id, the COSE public key bytes and the counter that the Worker has to store.
//
// Caveat: the Vitest pool turns Node.js compatibility on whatever wrangler.jsonc says, so this
// file proves "works in workerd", not "works without nodejs_compat". scripts/e2e-built-worker.ts
// runs the same ceremony against the built Worker in plain workerd with Node.js compat off.

/** The hex of the authenticator data of registration, written from WebAuthn section 6.1 by hand. */
const REGISTRATION_AUTH_DATA_HEX =
  RP_ID_HASH_HEX + // rpIdHash: SHA-256 of the RP ID
  '45' + // flags: UP (0x01) | UV (0x04) | AT (0x40)
  '00000000' + // signCount
  '00000000000000000000000000000000' + // AAGUID: 16 zero bytes
  '0010' + // credential id length: 16
  '0102030405060708090a0b0c0d0e0f10' + // credential id
  ES256_COSE_PUBLIC_KEY_HEX // credentialPublicKey

/** The attestation object, written from WebAuthn section 6.5 and RFC 8949 by hand. */
const REGISTRATION_ATTESTATION_OBJECT_HEX =
  'a3' + // map of 3 items
  '63666d74' + // "fmt"
  '646e6f6e65' + // "none"
  '6761747453746d74' + // "attStmt"
  'a0' + // an empty map: "none" has no statement
  '6861757468446174' +
  '61' + // "authData"
  '5894' + // a byte string of 148 bytes
  REGISTRATION_AUTH_DATA_HEX

describe('S5a: a full passkey ceremony in workerd (ES256, attestation "none")', () => {
  it('generates the registration options a browser needs', async () => {
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: USER_NAME,
      userID: USER_ID,
      challenge: CHALLENGE_BYTES,
    })

    expect(options).toEqual({
      challenge: CHALLENGE_B64U,
      rp: { name: 'Hollware Spike', id: 'cms.example.test' },
      user: { id: USER_ID_B64U, name: 'owner@example.test', displayName: '' },
      // The default list in workerd: no ML-DSA (SubtleCrypto.supports does not exist there).
      pubKeyCredParams: [
        { alg: -8, type: 'public-key' },
        { alg: -7, type: 'public-key' },
        { alg: -257, type: 'public-key' },
      ],
      timeout: 60000,
      attestation: 'none',
      excludeCredentials: [],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        requireResidentKey: false,
      },
      extensions: { credProps: true },
      hints: [],
    })
  })

  it('makes a random 32-byte challenge and a random user id when it is given none', async () => {
    const first = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: USER_NAME,
    })
    const second = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: USER_NAME,
    })

    // 32 random bytes are 43 base64url characters without padding.
    expect(first.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.user.id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second.challenge).not.toBe(first.challenge)
    expect(second.user.id).not.toBe(first.user.id)
  })

  it('registers a passkey: the authenticator answers, the library returns what to store', async () => {
    const { response, verification, credential } = await registerFixturePasskey()

    // What the software authenticator sends, byte for byte.
    expect(response.id).toBe(CREDENTIAL_ID_B64U)
    expect(response.rawId).toBe(CREDENTIAL_ID_B64U)
    expect(toHex(fromBase64Url(response.response.attestationObject))).toBe(
      REGISTRATION_ATTESTATION_OBJECT_HEX,
    )
    expect(new TextDecoder().decode(fromBase64Url(response.response.clientDataJSON))).toBe(
      '{"type":"webauthn.create","challenge":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",' +
        '"origin":"https://cms.example.test","crossOrigin":false}',
    )

    // What the library says about it: the stored credential, byte for byte.
    expect(verification.verified).toBe(true)
    expect(credential.id).toBe(CREDENTIAL_ID_B64U)
    expect(credential.publicKey).toBeInstanceOf(Uint8Array)
    expect(toHex(credential.publicKey)).toBe(ES256_COSE_PUBLIC_KEY_HEX)
    expect(credential.counter).toBe(0)
    expect(credential.transports).toEqual(['internal'])
    expect(verification.registrationInfo).toMatchObject({
      fmt: 'none',
      aaguid: '00000000-0000-0000-0000-000000000000',
      credentialType: 'public-key',
      userVerified: true,
      credentialDeviceType: 'singleDevice',
      credentialBackedUp: false,
      origin: 'https://cms.example.test',
      rpID: 'cms.example.test',
    })
    expect(toHex(verification.registrationInfo?.attestationObject ?? new Uint8Array())).toBe(
      REGISTRATION_ATTESTATION_OBJECT_HEX,
    )
  })

  it('signs in with the stored passkey: options, assertion, verification, counter 0 -> 1', async () => {
    const { authenticator, credential } = await registerFixturePasskey()

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      challenge: OTHER_CHALLENGE_BYTES,
      allowCredentials: [{ id: credential.id }],
    })
    expect(options).toEqual({
      rpId: 'cms.example.test',
      challenge: OTHER_CHALLENGE_B64U,
      allowCredentials: [{ id: CREDENTIAL_ID_B64U, type: 'public-key' }],
      timeout: 60000,
      userVerification: 'preferred',
    })

    const assertion = await authenticator.getAssertion(options, { origin: ORIGIN })
    // rpIdHash | flags UP+UV | signCount 1: no attested credential data in an assertion.
    expect(toHex(fromBase64Url(assertion.response.authenticatorData))).toBe(
      RP_ID_HASH_HEX + '05' + '00000001',
    )
    expect(assertion.response.userHandle).toBe(USER_ID_B64U)
    // A DER ECDSA signature: SEQUENCE, then two INTEGERs.
    const signature = fromBase64Url(assertion.response.signature)
    expect(signature[0]).toBe(0x30)
    expect(signature[1]).toBe(signature.length - 2)

    const result = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: options.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential,
    })

    expect(result).toEqual({
      verified: true,
      authenticationInfo: {
        newCounter: 1,
        credentialID: CREDENTIAL_ID_B64U,
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'https://cms.example.test',
        rpID: 'cms.example.test',
      },
    })
  })

  it('moves the stored counter forward: 0, then 1, then 2', async () => {
    const { authenticator, credential } = await registerFixturePasskey()
    let stored = credential

    const counters: number[] = []
    for (const challenge of [CHALLENGE_BYTES, OTHER_CHALLENGE_BYTES]) {
      const options = await generateAuthenticationOptions({ rpID: RP_ID, challenge })
      const assertion = await authenticator.getAssertion(options, { origin: ORIGIN })
      const result = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: options.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: stored,
      })
      expect(result.verified).toBe(true)
      counters.push(result.authenticationInfo.newCounter)
      // What the Worker does after a good sign-in: store the new counter.
      stored = { ...stored, counter: result.authenticationInfo.newCounter }
    }

    expect(counters).toEqual([1, 2])
    expect(stored.counter).toBe(2)
  })

  it('accepts a synced passkey: BE and BS set, the counter stays 0 on every sign-in', async () => {
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: USER_NAME,
      userID: USER_ID,
      challenge: CHALLENGE_BYTES,
    })
    // What iCloud Keychain and Google Password Manager send: multi-device, backed up, counter 0.
    const synced = await SoftwareAuthenticator.create({
      credentialId: CREDENTIAL_ID,
      backupEligible: true,
      backedUp: true,
      signCountBehavior: 'zero',
      transports: ['hybrid', 'internal'],
    })
    const registration = await verifyRegistrationResponse({
      response: await synced.createCredential(options, { origin: ORIGIN }),
      expectedChallenge: options.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    })
    if (!registration.verified) throw new Error('The synced passkey did not register')
    expect(registration.registrationInfo).toMatchObject({
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    })
    expect(registration.registrationInfo.credential.transports).toEqual(['hybrid', 'internal'])

    // Two sign-ins in a row: both report counter 0, and both verify. A counter of 0 on both sides
    // is not a replay for the library, so the counter cannot detect a cloned synced passkey.
    const newCounters: number[] = []
    for (const challenge of [CHALLENGE_BYTES, OTHER_CHALLENGE_BYTES]) {
      const authOptions = await generateAuthenticationOptions({ rpID: RP_ID, challenge })
      const result = await verifyAuthenticationResponse({
        response: await synced.getAssertion(authOptions, { origin: ORIGIN }),
        expectedChallenge: authOptions.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: registration.registrationInfo.credential,
      })
      expect(result.verified).toBe(true)
      expect(result.authenticationInfo).toMatchObject({
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
      })
      newCounters.push(result.authenticationInfo.newCounter)
    }
    expect(newCounters).toEqual([0, 0])
  })

  it('accepts the extra key Chrome adds to clientDataJSON (nobody may compare it with a template)', async () => {
    const authenticator = await SoftwareAuthenticator.create({
      credentialId: CREDENTIAL_ID,
      privateJwk: ES256_PRIVATE_JWK,
    })
    const registrationOptions = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: USER_NAME,
      userID: USER_ID,
      challenge: CHALLENGE_BYTES,
    })
    const registrationResponse = await authenticator.createCredential(registrationOptions, {
      origin: ORIGIN,
      greaseClientData: true,
    })
    expect(
      new TextDecoder().decode(fromBase64Url(registrationResponse.response.clientDataJSON)),
    ).toBe(
      '{"type":"webauthn.create","challenge":"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",' +
        '"origin":"https://cms.example.test","crossOrigin":false,' +
        '"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}',
    )
    const registration = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: registrationOptions.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    })
    if (!registration.verified)
      throw new Error('The registration with a greased clientDataJSON failed')

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      challenge: OTHER_CHALLENGE_BYTES,
    })
    const result = await verifyAuthenticationResponse({
      response: await authenticator.getAssertion(options, {
        origin: ORIGIN,
        greaseClientData: true,
      }),
      expectedChallenge: options.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: registration.registrationInfo.credential,
    })

    expect(result.verified).toBe(true)
  })

  // The default pubKeyCredParams offer EdDSA first, so an authenticator that can sign with it
  // (many security keys) will. RS256 is what Windows Hello used for years.
  it.each([
    { algorithm: 'EdDSA', coseAlg: COSEALG.EdDSA, coseKeyBytes: 42 },
    { algorithm: 'RS256', coseAlg: COSEALG.RS256, coseKeyBytes: 272 },
  ] as const)(
    'also verifies a $algorithm passkey end to end',
    async ({ algorithm, coseKeyBytes }) => {
      const authenticator = await SoftwareAuthenticator.create({
        credentialId: CREDENTIAL_ID,
        algorithm,
      })
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userName: USER_NAME,
        userID: USER_ID,
        challenge: CHALLENGE_BYTES,
      })
      const registration = await verifyRegistrationResponse({
        response: await authenticator.createCredential(options, { origin: ORIGIN }),
        expectedChallenge: options.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
      })
      if (!registration.verified) throw new Error(`The ${algorithm} passkey did not register`)
      expect(registration.registrationInfo.credential.publicKey.length).toBe(coseKeyBytes)

      const authOptions = await generateAuthenticationOptions({
        rpID: RP_ID,
        challenge: OTHER_CHALLENGE_BYTES,
      })
      const result = await verifyAuthenticationResponse({
        response: await authenticator.getAssertion(authOptions, { origin: ORIGIN }),
        expectedChallenge: authOptions.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: registration.registrationInfo.credential,
      })

      expect(result.verified).toBe(true)
      expect(result.authenticationInfo.newCounter).toBe(1)
    },
  )
})
