import {
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { COSEALG } from '@simplewebauthn/server/helpers'
import { describe, expect, it, vi } from 'vitest'
import { registerFixturePasskey, signInOptions } from '../support/ceremony.ts'
import {
  CHALLENGE_B64U,
  CHALLENGE_BYTES,
  CREDENTIAL_ID,
  ES256_PRIVATE_JWK,
  ORIGIN,
  OTHER_CHALLENGE_B64U,
  OTHER_CHALLENGE_BYTES,
  RP_ID,
  RP_NAME,
  USER_ID,
  USER_NAME,
  fromBase64Url,
  rejection,
  toBase64Url,
} from '../support/fixtures.ts'
import { SoftwareAuthenticator } from '../support/software-authenticator.ts'

// S5b. What @simplewebauthn/server 14.0.3 refuses, with the exact message, in workerd.
//
// Fails when: the library stops checking the origin, the RP ID, the challenge, the counter or the
// signature (the call resolves with verified: true), or changes the wording of what it throws, or
// the software authenticator stops producing a response that is valid except for the one thing
// each test breaks.
//
// A sibling of the RP's origin is the one the origin check exists for: the browser lets
// https://evil.cms.example.test use the RP ID cms.example.test (a parent domain), so only the
// origin in clientDataJSON tells it apart from https://cms.example.test.
const EVIL_ORIGIN = 'https://evil.cms.example.test'

/** Registers the fixture passkey and signs in once with it: a good assertion, not yet verified. */
async function goodAssertion() {
  const { authenticator, credential } = await registerFixturePasskey()
  const options = await signInOptions(OTHER_CHALLENGE_BYTES)
  const assertion = await authenticator.getAssertion(options, { origin: ORIGIN })
  const expected = {
    expectedChallenge: options.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential,
  }
  return { authenticator, credential, options, assertion, expected }
}

/** The same assertion with its signature bytes replaced by `change(signature)`. */
function withSignature(
  assertion: Awaited<ReturnType<typeof goodAssertion>>['assertion'],
  change: (signature: Uint8Array) => Uint8Array,
) {
  const signature = change(fromBase64Url(assertion.response.signature))
  return { ...assertion, response: { ...assertion.response, signature: toBase64Url(signature) } }
}

describe('S5b: registration is refused when something does not match', () => {
  const base = {
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: USER_NAME,
    userID: USER_ID,
    challenge: CHALLENGE_BYTES,
  }

  it('refuses a wrong origin', async () => {
    const options = await generateRegistrationOptions(base)
    const authenticator = await SoftwareAuthenticator.create({ credentialId: CREDENTIAL_ID })
    const response = await authenticator.createCredential(options, { origin: EVIL_ORIGIN })

    expect(
      await rejection(
        verifyRegistrationResponse({
          response,
          expectedChallenge: options.challenge,
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
        }),
      ),
    ).toEqual({
      name: 'Error',
      message:
        'Unexpected registration response origin "https://evil.cms.example.test", expected "https://cms.example.test"',
    })
  })

  it('refuses a wrong RP ID', async () => {
    const options = await generateRegistrationOptions(base)
    const authenticator = await SoftwareAuthenticator.create({ credentialId: CREDENTIAL_ID })
    const response = await authenticator.createCredential(options, { origin: ORIGIN })

    expect(
      await rejection(
        verifyRegistrationResponse({
          response,
          expectedChallenge: options.challenge,
          expectedOrigin: ORIGIN,
          expectedRPID: 'other.example.test',
        }),
      ),
    ).toEqual({ name: 'UnexpectedRPIDHash', message: 'Unexpected RP ID hash' })
  })

  it('refuses a wrong challenge', async () => {
    const options = await generateRegistrationOptions(base)
    const authenticator = await SoftwareAuthenticator.create({ credentialId: CREDENTIAL_ID })
    const response = await authenticator.createCredential(options, { origin: ORIGIN })

    expect(
      await rejection(
        verifyRegistrationResponse({
          response,
          expectedChallenge: OTHER_CHALLENGE_B64U,
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
        }),
      ),
    ).toEqual({
      name: 'Error',
      message:
        'Unexpected registration response challenge "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8", ' +
        'expected "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8"',
    })
  })

  it('refuses a challenge the function form rejects (how a single-use store is wired)', async () => {
    const options = await generateRegistrationOptions(base)
    const authenticator = await SoftwareAuthenticator.create({ credentialId: CREDENTIAL_ID })
    const response = await authenticator.createCredential(options, { origin: ORIGIN })
    const seen: string[] = []

    expect(
      await rejection(
        verifyRegistrationResponse({
          response,
          expectedChallenge: (challenge) => {
            seen.push(challenge)
            return false
          },
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
        }),
      ),
    ).toEqual({
      name: 'Error',
      message:
        'Custom challenge verifier returned false for registration response challenge ' +
        '"AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"',
    })
    // The function gets the challenge from clientDataJSON, exactly once.
    expect(seen).toEqual([CHALLENGE_B64U])
  })

  it('refuses an authenticator that did not verify the user, unless UV is not required', async () => {
    const options = await generateRegistrationOptions(base)
    const authenticator = await SoftwareAuthenticator.create({
      credentialId: CREDENTIAL_ID,
      userVerified: false,
    })
    const response = await authenticator.createCredential(options, { origin: ORIGIN })
    const expected = {
      response,
      expectedChallenge: options.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    }

    expect(await rejection(verifyRegistrationResponse(expected))).toEqual({
      name: 'Error',
      message: 'User verification was required, but user could not be verified',
    })
    const lenient = await verifyRegistrationResponse({
      ...expected,
      requireUserVerification: false,
    })
    expect(lenient.verified).toBe(true)
    expect(lenient.registrationInfo?.userVerified).toBe(false)
  })
})

describe('S5b: sign-in is refused when something does not match', () => {
  it('refuses a wrong origin', async () => {
    const { authenticator, credential, options } = await goodAssertion()
    const assertion = await authenticator.getAssertion(options, { origin: EVIL_ORIGIN })

    expect(
      await rejection(
        verifyAuthenticationResponse({
          response: assertion,
          expectedChallenge: options.challenge,
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
          credential,
        }),
      ),
    ).toEqual({
      name: 'Error',
      message:
        'Unexpected authentication response origin "https://evil.cms.example.test", expected "https://cms.example.test"',
    })
  })

  it('refuses a wrong RP ID', async () => {
    const { assertion, expected } = await goodAssertion()

    expect(
      await rejection(
        verifyAuthenticationResponse({
          ...expected,
          response: assertion,
          expectedRPID: 'other.example.test',
        }),
      ),
    ).toEqual({ name: 'UnexpectedRPIDHash', message: 'Unexpected RP ID hash' })
  })

  it('refuses a wrong challenge', async () => {
    const { assertion, expected } = await goodAssertion()

    expect(
      await rejection(
        verifyAuthenticationResponse({
          ...expected,
          response: assertion,
          expectedChallenge: CHALLENGE_B64U,
        }),
      ),
    ).toEqual({
      name: 'Error',
      message:
        'Unexpected authentication response challenge "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8", ' +
        'expected "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"',
    })
  })

  it('refuses a challenge the function form rejects, and words it as "registration" (a library typo)', async () => {
    const { assertion, expected } = await goodAssertion()

    expect(
      await rejection(
        verifyAuthenticationResponse({
          ...expected,
          response: assertion,
          expectedChallenge: () => false,
        }),
      ),
    ).toEqual({
      name: 'Error',
      message:
        'Custom challenge verifier returned false for registration response challenge ' +
        '"ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8"',
    })
  })

  it('refuses a replay: the counter did not increase (equal to the stored one)', async () => {
    const { assertion, expected } = await goodAssertion()
    const firstTime = await verifyAuthenticationResponse({ ...expected, response: assertion })
    expect(firstTime.verified).toBe(true)
    expect(firstTime.authenticationInfo.newCounter).toBe(1)

    // The Worker stored newCounter = 1. The very same assertion arrives again.
    const replayed = verifyAuthenticationResponse({
      ...expected,
      response: assertion,
      credential: { ...expected.credential, counter: firstTime.authenticationInfo.newCounter },
    })

    // "lower than" even when it is equal: the message does not tell the two cases apart.
    expect(await rejection(replayed)).toEqual({
      name: 'Error',
      message: 'Response counter value 1 was lower than expected 1',
    })
  })

  it('refuses a counter that went backwards', async () => {
    const { authenticator, options, expected } = await goodAssertion()
    // A cloned authenticator that has signed 3 times, against a stored counter of 5.
    authenticator.signCount = 2
    const assertion = await authenticator.getAssertion(options, { origin: ORIGIN })

    expect(
      await rejection(
        verifyAuthenticationResponse({
          ...expected,
          response: assertion,
          credential: { ...expected.credential, counter: 5 },
        }),
      ),
    ).toEqual({ name: 'Error', message: 'Response counter value 3 was lower than expected 5' })
  })

  it('returns verified: false, without throwing, for a signature changed by one bit', async () => {
    const { assertion, expected } = await goodAssertion()
    // Byte 10 is inside r for a P-256 signature (30 LL 02 LL r...), so the DER stays well formed.
    const tampered = withSignature(assertion, (signature) => {
      const copy = signature.slice()
      copy[10] = (copy[10] ?? 0) ^ 0x01
      return copy
    })

    const result = await verifyAuthenticationResponse({ ...expected, response: tampered })

    expect(result.verified).toBe(false)
    // The rest of authenticationInfo is filled in anyway: a caller must not read newCounter here.
    expect(result.authenticationInfo.newCounter).toBe(1)
  })

  it('returns verified: false for a valid signature made by another key', async () => {
    const { expected, options } = await goodAssertion()
    const attacker = await SoftwareAuthenticator.create({ credentialId: CREDENTIAL_ID })
    const assertion = await attacker.getAssertion(options, { origin: ORIGIN })

    const result = await verifyAuthenticationResponse({ ...expected, response: assertion })

    expect(result.verified).toBe(false)
  })

  it('returns verified: false when authenticatorData changed after signing (counter raised)', async () => {
    const { assertion, expected } = await goodAssertion()
    // An attacker raises the counter from 1 to 2 so the counter check passes. The signature covers it.
    const authenticatorData = fromBase64Url(assertion.response.authenticatorData)
    authenticatorData[36] = 2
    const tampered = {
      ...assertion,
      response: { ...assertion.response, authenticatorData: toBase64Url(authenticatorData) },
    }

    const result = await verifyAuthenticationResponse({ ...expected, response: tampered })

    expect(result.verified).toBe(false)
    expect(result.authenticationInfo.newCounter).toBe(2)
  })

  it('returns verified: false when clientDataJSON was rewritten to carry the expected challenge', async () => {
    const { authenticator, credential } = await registerFixturePasskey()
    // The assertion answers challenge A. The attacker rewrites clientDataJSON to say B, which is
    // what the server expects: the challenge check passes, the signature check does not.
    const options = await signInOptions(CHALLENGE_BYTES)
    const assertion = await authenticator.getAssertion(options, { origin: ORIGIN })
    const clientData = new TextDecoder().decode(fromBase64Url(assertion.response.clientDataJSON))
    const rewritten = clientData.replace(CHALLENGE_B64U, OTHER_CHALLENGE_B64U)
    expect(rewritten).not.toBe(clientData)
    const tampered = {
      ...assertion,
      response: {
        ...assertion.response,
        clientDataJSON: toBase64Url(new TextEncoder().encode(rewritten)),
      },
    }

    const result = await verifyAuthenticationResponse({
      response: tampered,
      expectedChallenge: OTHER_CHALLENGE_B64U,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential,
    })

    expect(result.verified).toBe(false)
  })

  // A signature that is not DER at all never reaches the verifier: the ASN.1 parser throws.
  it.each([
    {
      case: 'a wrong SEQUENCE tag (0x31)',
      change: (signature: Uint8Array) => Uint8Array.of(0x31, ...signature.subarray(1)),
      message: 'Data does not match to ECDSASigValue ASN1 schema.',
    },
    {
      case: 'a truncated signature',
      change: (signature: Uint8Array) => signature.subarray(0, 20),
      message:
        'End of input reached before message was fully decoded (inconsistent offset and length values)',
    },
    {
      case: 'a raw r||s signature (what WebCrypto returns) instead of DER',
      change: () => new Uint8Array(64).fill(7),
      message: 'Data does not match to ECDSASigValue ASN1 schema.',
    },
    {
      case: 'an empty signature',
      change: () => new Uint8Array(0),
      message: 'Input buffer has zero length',
    },
  ])('throws for $case', async ({ change, message }) => {
    const { assertion, expected } = await goodAssertion()

    expect(
      await rejection(
        verifyAuthenticationResponse({ ...expected, response: withSignature(assertion, change) }),
      ),
    ).toEqual({ name: 'Error', message })
  })

  it('refuses an assertion without user verification, unless UV is not required', async () => {
    const { credential } = await registerFixturePasskey()
    // The same passkey (same key and id), used on a device that did not verify the user this time.
    const withoutUv = await SoftwareAuthenticator.create({
      credentialId: CREDENTIAL_ID,
      privateJwk: ES256_PRIVATE_JWK,
      userVerified: false,
    })
    const options = await signInOptions(OTHER_CHALLENGE_BYTES)
    const expected = {
      response: await withoutUv.getAssertion(options, { origin: ORIGIN }),
      expectedChallenge: options.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential,
    }

    // Note the wording: "User verification required", not "was required" as in registration.
    expect(await rejection(verifyAuthenticationResponse(expected))).toEqual({
      name: 'Error',
      message: 'User verification required, but user could not be verified',
    })
    const lenient = await verifyAuthenticationResponse({
      ...expected,
      requireUserVerification: false,
    })
    expect(lenient.verified).toBe(true)
    expect(lenient.authenticationInfo.userVerified).toBe(false)
  })
})

// Behaviours of the library that are not errors but that a Worker has to know. Each test pins what
// the library does today; when one fails after an upgrade, the Hollware wrapper needs a second look.
describe('S5b: behaviours of the library the Hollware wrapper must close', () => {
  it('registration without expectedRPID accepts an RP ID hash of another site', async () => {
    // A browser lets https://cms.example.test ask for the RP ID example.test (a parent domain).
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: 'example.test',
      userName: USER_NAME,
      userID: USER_ID,
      challenge: CHALLENGE_BYTES,
    })
    const authenticator = await SoftwareAuthenticator.create({ credentialId: CREDENTIAL_ID })
    const response = await authenticator.createCredential(options, { origin: ORIGIN })
    const withoutRpId = {
      response,
      expectedChallenge: options.challenge,
      expectedOrigin: ORIGIN,
    }

    const unchecked = await verifyRegistrationResponse(withoutRpId)
    expect(unchecked.verified).toBe(true)
    expect(unchecked.registrationInfo?.rpID).toBeUndefined()
    expect(
      await rejection(verifyRegistrationResponse({ ...withoutRpId, expectedRPID: RP_ID })),
    ).toEqual({
      name: 'UnexpectedRPIDHash',
      message: 'Unexpected RP ID hash',
    })
  })

  it('treats a string challenge as text to encode, not as base64url (it is encoded twice)', async () => {
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: USER_NAME,
      userID: USER_ID,
      challenge: CHALLENGE_B64U,
    })

    // base64url("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"): `printf %s <challenge> | base64`.
    expect(options.challenge).toBe('QUFFQ0F3UUZCZ2NJQ1FvTERBME9EeEFSRWhNVUZSWVhHQmthR3h3ZEhoOA')
  })

  it('refuses a string userID: the id is bytes, and an email must never be it', async () => {
    await expect(
      generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userName: USER_NAME,
        // @ts-expect-error the type says Uint8Array; a caller coming from an older version sends a string
        userID: 'user-0001',
      }),
    ).rejects.toThrow(
      'String values for `userID` are no longer supported. See https://simplewebauthn.dev/docs/advanced/server/custom-user-ids',
    )
  })

  it('keeps the algorithms the RP pins: an EdDSA key is refused when only ES256 is allowed', async () => {
    // Pin the list on both sides. The default list depends on the runtime: workerd gives
    // [-8, -7, -257], Node 24 adds ML-DSA-44 (-48) in front, and a passkey of an algorithm the
    // runtime cannot verify would register and then fail on every sign-in.
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: USER_NAME,
      userID: USER_ID,
      challenge: CHALLENGE_BYTES,
      supportedAlgorithmIDs: [COSEALG.ES256],
    })
    expect(options.pubKeyCredParams).toEqual([{ alg: -7, type: 'public-key' }])

    const eddsa = await SoftwareAuthenticator.create({
      credentialId: CREDENTIAL_ID,
      algorithm: 'EdDSA',
    })
    // A well-behaved authenticator cannot answer...
    await expect(eddsa.createCredential(options, { origin: ORIGIN })).rejects.toThrow(
      'NotSupportedError: EdDSA (-8) is not in [-7]',
    )
    // ...and a response forged with EdDSA anyway is refused by the verifier.
    const forged = await eddsa.createCredential(
      { ...options, pubKeyCredParams: [{ alg: -8, type: 'public-key' }] },
      { origin: ORIGIN },
    )
    expect(
      await rejection(
        verifyRegistrationResponse({
          response: forged,
          expectedChallenge: options.challenge,
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
          supportedAlgorithmIDs: [COSEALG.ES256],
        }),
      ),
    ).toEqual({ name: 'Error', message: 'Unexpected public key alg "-8", expected one of "-7"' })
  })

  it('adds reflect-metadata to the global Reflect when the library is imported', () => {
    // `import "reflect-metadata"` in the library's certificate helpers: a side effect on the
    // isolate's global, there for every other module of the Worker.
    expect('getMetadata' in Reflect).toBe(true)
  })

  it('writes into the default authenticatorSelection it shares across calls (state leaks between requests)', async () => {
    // A pristine copy of the library, so the leak does not reach the other tests of this file.
    vi.resetModules()
    const fresh = await import('@simplewebauthn/server')
    const base = { rpName: RP_NAME, rpID: RP_ID, userName: USER_NAME, userID: USER_ID }

    const first = await fresh.generateRegistrationOptions({
      ...base,
      preferredAuthenticatorType: 'securityKey',
    })
    const second = await fresh.generateRegistrationOptions(base)

    expect(first.authenticatorSelection?.authenticatorAttachment).toBe('cross-platform')
    // The next request did not ask for a security key, and still gets one.
    expect(second.authenticatorSelection?.authenticatorAttachment).toBe('cross-platform')
    expect(second.authenticatorSelection).toBe(first.authenticatorSelection)
  })

  it('does not leak when every call passes its own authenticatorSelection object', async () => {
    vi.resetModules()
    const fresh = await import('@simplewebauthn/server')
    const base = { rpName: RP_NAME, rpID: RP_ID, userName: USER_NAME, userID: USER_ID }

    await fresh.generateRegistrationOptions({
      ...base,
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      preferredAuthenticatorType: 'securityKey',
    })
    const next = await fresh.generateRegistrationOptions({
      ...base,
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    })

    expect(next.authenticatorSelection).toEqual({
      residentKey: 'preferred',
      userVerification: 'preferred',
      requireResidentKey: false,
    })
  })
})
