import { HollwareError, newId } from '@hollware/core'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type { Db } from '../db/d1.ts'
import { userHandle } from './secrets.ts'
import {
  addPasskey,
  createSession,
  createUser,
  findInvitation,
  invitationById,
  findPasskey,
  passkeysOf,
  redeemInvitation,
  saveChallenge,
  takeChallenge,
  touchPasskey,
} from './store.ts'

/**
 * The passkey ceremonies (ADR-026), with SimpleWebAuthn: registration redeems an invitation (the
 * owner's setup link or an invitation with a role), and sign-in opens a session. The relying party
 * is the public URL of the Worker: its host is the RP ID, always given, and its origin the only
 * origin accepted. Every option object is built for one call, never shared.
 */

export interface Ceremony {
  readonly db: Db
  readonly site: string
  /** The public URL of the Worker, `HOLLWARE_PUBLIC_URL`. */
  readonly publicUrl: string
  readonly now: Date
}

/** How long a session lasts: a working day. */
const SESSION_HOURS = 12

function relyingParty(ceremony: Ceremony) {
  const url = new URL(ceremony.publicUrl)
  return { id: url.hostname, origin: url.origin }
}

function refused(message: string, fix: string): HollwareError {
  return new HollwareError('invalid_input', message, fix)
}

/** The options of `navigator.credentials.create` for the person of an invitation. */
export async function registrationOptions(ceremony: Ceremony, invitationSecret: string) {
  const invitation = await findInvitation(
    ceremony.db,
    ceremony.site,
    invitationSecret,
    ceremony.now,
  )
  if (invitation === null) {
    throw refused(
      'This link is not valid: it was used already, or it expired.',
      'Ask the owner of this Hollware for a new invitation.',
    )
  }
  const userId = invitation.userId ?? newId('usr')
  const existing =
    invitation.userId === null
      ? []
      : await passkeysOf(ceremony.db, ceremony.site, invitation.userId)
  const rp = relyingParty(ceremony)
  const options = await generateRegistrationOptions({
    rpName: 'Hollware',
    rpID: rp.id,
    userName: userId,
    userID: userHandle(userId),
    attestationType: 'none',
    excludeCredentials: existing.map((passkey) => ({ id: passkey.credentialId })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  })
  const challengeId = await saveChallenge(ceremony.db, {
    site: ceremony.site,
    challenge: options.challenge,
    purpose: 'register',
    invitationId: invitation.id,
    userId,
    now: ceremony.now,
  })
  return { challengeId, options }
}

/**
 * Verifies a registration and redeems its invitation, once: a new person is made with the
 * invitation's role, or the passkey joins the person the link names. Opens their session.
 */
export async function verifyRegistration(
  ceremony: Ceremony,
  input: {
    readonly challengeId: string
    readonly response: RegistrationResponseJSON
    /** The name of a new person; ignored when the link names an existing one. */
    readonly name: string
    readonly label: string
  },
): Promise<{ userId: string; session: string }> {
  const challenge = await takeChallenge(ceremony.db, {
    site: ceremony.site,
    id: input.challengeId,
    purpose: 'register',
    now: ceremony.now,
  })
  if (challenge === null || challenge.invitationId === null || challenge.userId === null) {
    throw refused('The registration expired.', 'Start again from the link.')
  }
  const rp = relyingParty(ceremony)
  const verified = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.id,
  })
  if (!verified.verified) throw refused('The passkey could not be verified.', 'Try again.')
  const invitation = await invitationById(ceremony.db, ceremony.site, challenge.invitationId)
  if (
    invitation === null ||
    !(await redeemInvitation(ceremony.db, ceremony.site, invitation.id, ceremony.now))
  ) {
    throw refused(
      'This link is not valid: it was used already, or it expired.',
      'Ask the owner of this Hollware for a new invitation.',
    )
  }
  if (invitation.userId === null) {
    await createUser(ceremony.db, {
      id: challenge.userId,
      name: input.name.trim() === '' ? 'Unnamed' : input.name.trim(),
      role: invitation.role,
      site: ceremony.site,
      now: ceremony.now,
    })
  }
  const { credential } = verified.registrationInfo
  await addPasskey(ceremony.db, {
    site: ceremony.site,
    userId: challenge.userId,
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    label: input.label.trim() === '' ? 'Passkey' : input.label.trim(),
    now: ceremony.now,
  })
  const session = await createSession(ceremony.db, {
    site: ceremony.site,
    userId: challenge.userId,
    now: ceremony.now,
    hours: SESSION_HOURS,
  })
  return { userId: challenge.userId, session: session.secret }
}

/** The options of `navigator.credentials.get`: any passkey of this site, chosen by the person. */
export async function authenticationOptions(ceremony: Ceremony) {
  const rp = relyingParty(ceremony)
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    userVerification: 'preferred',
  })
  const challengeId = await saveChallenge(ceremony.db, {
    site: ceremony.site,
    challenge: options.challenge,
    purpose: 'authenticate',
    invitationId: null,
    userId: null,
    now: ceremony.now,
  })
  return { challengeId, options }
}

/** Verifies a sign-in with a passkey of this site, and opens the person's session. */
export async function verifyAuthentication(
  ceremony: Ceremony,
  input: { readonly challengeId: string; readonly response: AuthenticationResponseJSON },
): Promise<{ userId: string; session: string }> {
  const challenge = await takeChallenge(ceremony.db, {
    site: ceremony.site,
    id: input.challengeId,
    purpose: 'authenticate',
    now: ceremony.now,
  })
  if (challenge === null) throw refused('The sign-in expired.', 'Sign in again.')
  const passkey = await findPasskey(ceremony.db, ceremony.site, input.response.id)
  if (passkey === null) {
    throw refused('This passkey is not one of this Hollware.', 'Use a passkey you registered here.')
  }
  const rp = relyingParty(ceremony)
  const verified = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.id,
    credential: {
      id: passkey.credentialId,
      publicKey: isoBase64URL.toBuffer(passkey.publicKey),
      counter: passkey.counter,
      transports: JSON.parse(passkey.transports),
    },
  })
  if (!verified.verified) throw refused('The passkey could not be verified.', 'Try again.')
  await touchPasskey(ceremony.db, passkey.id, verified.authenticationInfo.newCounter, ceremony.now)
  const session = await createSession(ceremony.db, {
    site: ceremony.site,
    userId: passkey.userId,
    now: ceremony.now,
    hours: SESSION_HOURS,
  })
  return { userId: passkey.userId, session: session.secret }
}
