// The library calls every test of the ceremony repeats, with the fixtures of fixtures.ts.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import {
  CHALLENGE_BYTES,
  CREDENTIAL_ID,
  ES256_PRIVATE_JWK,
  ORIGIN,
  RP_ID,
  RP_NAME,
  USER_ID,
  USER_NAME,
} from './fixtures.ts'
import { SoftwareAuthenticator } from './software-authenticator.ts'
import type { SoftwareAuthenticatorOptions } from './software-authenticator.ts'

/**
 * Registers the fixture passkey (fixed ES256 key, credential id 0x01..0x10) with a registration
 * that must verify. Returns what a Relying Party would have stored.
 */
export async function registerFixturePasskey(
  authenticatorOptions: Partial<SoftwareAuthenticatorOptions> = {},
) {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: USER_NAME,
    userID: USER_ID,
    challenge: CHALLENGE_BYTES,
  })
  const authenticator = await SoftwareAuthenticator.create({
    credentialId: CREDENTIAL_ID,
    privateJwk: ES256_PRIVATE_JWK,
    ...authenticatorOptions,
  })
  const response = await authenticator.createCredential(options, { origin: ORIGIN })
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: options.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  })
  if (!verification.verified) throw new Error('The fixture registration did not verify')
  return {
    options,
    authenticator,
    response,
    verification,
    credential: verification.registrationInfo.credential,
  }
}

/** Sign-in options for the fixture RP with the given challenge bytes. */
export function signInOptions(challenge: Uint8Array<ArrayBuffer>) {
  return generateAuthenticationOptions({ rpID: RP_ID, challenge })
}
