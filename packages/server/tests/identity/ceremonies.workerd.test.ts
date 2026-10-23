import { env } from 'cloudflare:workers'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { describe, expect, it } from 'vitest'

import { connect } from '../../src/db/d1.ts'
import {
  authenticationOptions,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
  type Ceremony,
} from '../../src/identity/ceremonies.ts'
import { createInvitation, findSession, membershipsOf } from '../../src/identity/store.ts'
import { seedOwner, siteKey } from '../db/support.ts'
import { softAuthenticator } from '../support/authenticator.ts'

// Fails when: the passkey ceremonies (src/identity) stop letting a person in the way ADR-026 says:
// a setup link adds a passkey to the owner it names and an invitation makes a new person with its
// role, each once and before it expires; sign-in with a registered passkey opens a session that
// knows the person, whose role is that of each site they are a member of; and a registration or a sign-in from another origin, a
// challenge used twice, an invitation redeemed by a second registration, a signature that does
// not verify, a passkey of no one, a challenge older than five minutes, a counter that went
// back or an assertion without user verification is refused.

const ORIGIN = 'https://cms.example.com'
const NOW = new Date('2026-10-14T10:00:00.000Z')

async function site() {
  const owner = await seedOwner(env.DB, siteKey('identity'))
  const ceremony: Ceremony = { db: connect(env.DB), publicUrl: ORIGIN, now: NOW }
  return { owner, ceremony }
}

/** Registers a passkey through an invitation, and gives the authenticator and the answer. */
async function register(ceremony: Ceremony, secret: string, from = ORIGIN) {
  const authenticator = await softAuthenticator(ORIGIN)
  const { challengeId, options } = await registrationOptions(ceremony, secret)
  const response = await authenticator.register(options, from)
  const answer = await verifyRegistration(ceremony, {
    challengeId,
    response,
    name: 'Ada',
    label: 'Laptop',
  })
  return { authenticator, answer }
}

describe('registration', () => {
  it('adds a passkey to the owner of a setup link, once', async () => {
    const { owner, ceremony } = await site()
    const link = await createInvitation(ceremony.db, {
      site: owner.site,
      role: 'owner',
      userId: owner.actor.userId,
      now: NOW,
      days: 7,
    })

    const { answer } = await register(ceremony, link.secret)

    expect(answer.userId).toBe(owner.actor.userId)
    expect(await findSession(ceremony.db, answer.session, NOW)).toEqual({
      userId: owner.actor.userId,
      name: 'Owner',
    })
    await expect(registrationOptions(ceremony, link.secret)).rejects.toThrow(
      'This link is not valid',
    )
  })

  it('makes a new person with the role of an invitation', async () => {
    const { owner, ceremony } = await site()
    const invitation = await createInvitation(ceremony.db, {
      site: owner.site,
      role: 'author',
      userId: null,
      now: NOW,
      days: 7,
    })

    const { answer } = await register(ceremony, invitation.secret)

    expect(answer.userId).not.toBe(owner.actor.userId)
    expect(await findSession(ceremony.db, answer.session, NOW)).toEqual({
      userId: answer.userId,
      name: 'Ada',
    })
    expect(await membershipsOf(ceremony.db, answer.userId)).toEqual([
      { site: owner.site, role: 'author' },
    ])
  })

  it('lets one person in through an invitation, even when two registrations start from it', async () => {
    const { owner, ceremony } = await site()
    const invitation = await createInvitation(ceremony.db, {
      site: owner.site,
      role: 'editor',
      userId: null,
      now: NOW,
      days: 7,
    })
    const authenticator = await softAuthenticator(ORIGIN)
    const first = await registrationOptions(ceremony, invitation.secret)
    const second = await registrationOptions(ceremony, invitation.secret)
    const finish = async (started: typeof first) =>
      verifyRegistration(ceremony, {
        challengeId: started.challengeId,
        response: await authenticator.register(started.options, ORIGIN),
        name: 'Ada',
        label: 'Laptop',
      })

    await finish(first)

    await expect(finish(second)).rejects.toThrow('This link is not valid')
  })

  it('refuses an invitation that expired, and a passkey made for another origin', async () => {
    const { owner, ceremony } = await site()
    const expired = await createInvitation(ceremony.db, {
      site: owner.site,
      role: 'author',
      userId: null,
      now: new Date('2026-10-01T10:00:00.000Z'),
      days: 7,
    })
    const fresh = await createInvitation(ceremony.db, {
      site: owner.site,
      role: 'author',
      userId: null,
      now: NOW,
      days: 7,
    })

    await expect(registrationOptions(ceremony, expired.secret)).rejects.toThrow(
      'This link is not valid',
    )
    await expect(register(ceremony, fresh.secret, 'https://evil.example.com')).rejects.toThrow()
  })
})

describe('sign-in', () => {
  it('opens a session with a registered passkey, and refuses its challenge a second time', async () => {
    const { owner, ceremony } = await site()
    const link = await createInvitation(ceremony.db, {
      site: owner.site,
      role: 'owner',
      userId: owner.actor.userId,
      now: NOW,
      days: 7,
    })
    const { authenticator } = await register(ceremony, link.secret)
    const { challengeId, options } = await authenticationOptions(ceremony)
    const response = await authenticator.authenticate(options)

    const answer = await verifyAuthentication(ceremony, { challengeId, response })

    expect((await findSession(ceremony.db, answer.session, NOW))?.userId).toBe(owner.actor.userId)
    await expect(verifyAuthentication(ceremony, { challengeId, response })).rejects.toThrow(
      'The sign-in expired',
    )
  })

  it('refuses an assertion whose signature does not verify', async () => {
    const { owner, ceremony } = await site()
    const link = await createInvitation(ceremony.db, {
      site: owner.site,
      role: 'owner',
      userId: owner.actor.userId,
      now: NOW,
      days: 7,
    })
    const { authenticator } = await register(ceremony, link.secret)
    const { challengeId, options } = await authenticationOptions(ceremony)
    const response = await authenticator.authenticate(options)
    // One bit of the integer r of the DER signature, so that it is still a well-formed signature.
    const signature = isoBase64URL.toBuffer(response.response.signature)
    signature[10] = (signature[10] ?? 0) ^ 1
    const forged = {
      ...response,
      response: { ...response.response, signature: isoBase64URL.fromBuffer(signature) },
    }

    await expect(verifyAuthentication(ceremony, { challengeId, response: forged })).rejects.toThrow(
      'The passkey could not be verified',
    )
  })

  /** A site whose owner registered a passkey, ready to sign in. */
  async function registered() {
    const { owner, ceremony } = await site()
    const link = await createInvitation(ceremony.db, {
      site: owner.site,
      role: 'owner',
      userId: owner.actor.userId,
      now: NOW,
      days: 7,
    })
    const { authenticator } = await register(ceremony, link.secret)
    return { ceremony, authenticator }
  }

  it('refuses a challenge older than five minutes, and takes one of just under', async () => {
    const { ceremony, authenticator } = await registered()
    const late = await authenticationOptions(ceremony)
    const lateResponse = await authenticator.authenticate(late.options)
    const inTime = await authenticationOptions(ceremony)
    const inTimeResponse = await authenticator.authenticate(inTime.options)
    const at = (ms: number) => ({ ...ceremony, now: new Date(NOW.getTime() + ms) })

    await expect(
      verifyAuthentication(at(300_000), { challengeId: late.challengeId, response: lateResponse }),
    ).rejects.toThrow('The sign-in expired')
    await expect(
      verifyAuthentication(at(299_999), {
        challengeId: inTime.challengeId,
        response: inTimeResponse,
      }),
    ).resolves.toMatchObject({ userId: expect.stringMatching(/^usr_/) })
  })

  it('refuses a counter that went back, as a cloned authenticator gives', async () => {
    const { ceremony, authenticator } = await registered()
    const first = await authenticationOptions(ceremony)
    await verifyAuthentication(ceremony, {
      challengeId: first.challengeId,
      response: await authenticator.authenticate(first.options, ORIGIN, { counter: 5 }),
    })
    const clone = await authenticationOptions(ceremony)

    await expect(
      verifyAuthentication(ceremony, {
        challengeId: clone.challengeId,
        response: await authenticator.authenticate(clone.options, ORIGIN, { counter: 3 }),
      }),
    ).rejects.toThrow('The passkey could not be verified')
  })

  it('refuses a sign-in in which the device was touched but not unlocked', async () => {
    const { ceremony, authenticator } = await registered()
    const { challengeId, options } = await authenticationOptions(ceremony)

    await expect(
      verifyAuthentication(ceremony, {
        challengeId,
        response: await authenticator.authenticate(options, ORIGIN, { userVerified: false }),
      }),
    ).rejects.toThrow('The passkey could not be verified')
  })

  it('refuses a passkey of no one, and an assertion for another origin', async () => {
    const { owner, ceremony } = await site()
    const link = await createInvitation(ceremony.db, {
      site: owner.site,
      role: 'owner',
      userId: owner.actor.userId,
      now: NOW,
      days: 7,
    })
    const { authenticator } = await register(ceremony, link.secret)
    const stranger = await softAuthenticator(ORIGIN)

    const first = await authenticationOptions(ceremony)
    await expect(
      verifyAuthentication(ceremony, {
        challengeId: first.challengeId,
        response: await stranger.authenticate(first.options),
      }),
    ).rejects.toThrow('This passkey is not one of this Hollware')
    const second = await authenticationOptions(ceremony)
    await expect(
      verifyAuthentication(ceremony, {
        challengeId: second.challengeId,
        response: await authenticator.authenticate(second.options, 'https://evil.example.com'),
      }),
    ).rejects.toThrow('The passkey could not be verified')
  })
})
