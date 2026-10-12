import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { ES256_PRIVATE_JWK, ORIGIN, RP_ID } from '../support/fixtures.ts'
import { SoftwareAuthenticator } from '../support/software-authenticator.ts'

// The spike Worker (src/index.ts) driven over its HTTP routes by the software authenticator.
//
// Fails when: a route stops answering with the literal JSON below, the Worker stops using the
// function form of expectedChallenge as a single-use store, stops checking `verified`, stops passing
// expectedOrigin / expectedRPID from its vars, or stops storing the new counter.
//
// The Worker keeps its state in module memory, which this file shares across its tests, so every
// test registers a credential id of its own.

async function post(path: string, body?: unknown, base: string = ORIGIN) {
  const response = await exports.default.fetch(`${base}${path}`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json<unknown>() }
}

/** A credential id of 16 bytes, all `seed`: base64url of it is what the Worker answers with. */
const credentialIdOf = (seed: number) => new Uint8Array(16).fill(seed)

async function registerThroughWorker(authenticator: SoftwareAuthenticator, origin = ORIGIN) {
  const options = (await post('/register/options')).body
  if (!isRegistrationOptions(options)) throw new Error('Unexpected registration options')
  return post('/register/verify', await authenticator.createCredential(options, { origin }))
}

async function loginOptions() {
  const options = (await post('/login/options')).body
  if (!isRequestOptions(options)) throw new Error('Unexpected login options')
  return options
}

function isRegistrationOptions(
  value: unknown,
): value is Parameters<SoftwareAuthenticator['createCredential']>[0] {
  return typeof value === 'object' && value !== null && 'pubKeyCredParams' in value && 'rp' in value
}
function isRequestOptions(
  value: unknown,
): value is Parameters<SoftwareAuthenticator['getAssertion']>[0] {
  return typeof value === 'object' && value !== null && 'challenge' in value && 'rpId' in value
}

describe('the spike Worker over HTTP', () => {
  it('registers a passkey, then signs in twice with it: counter 0, 1, 2', async () => {
    const authenticator = await SoftwareAuthenticator.create({ credentialId: credentialIdOf(0x11) })

    const registered = await registerThroughWorker(authenticator)
    expect(registered).toEqual({
      status: 200,
      // 0x11 x 16 as base64url.
      body: { verified: true, credentialId: 'EREREREREREREREREREREQ', counter: 0 },
    })

    const first = await post(
      '/login/verify',
      await authenticator.getAssertion(await loginOptions(), { origin: ORIGIN }),
    )
    expect(first).toEqual({ status: 200, body: { verified: true, newCounter: 1 } })
    const second = await post(
      '/login/verify',
      await authenticator.getAssertion(await loginOptions(), { origin: ORIGIN }),
    )
    expect(second).toEqual({ status: 200, body: { verified: true, newCounter: 2 } })
  })

  it('refuses the same assertion twice: the challenge is single use', async () => {
    const authenticator = await SoftwareAuthenticator.create({ credentialId: credentialIdOf(0x22) })
    await registerThroughWorker(authenticator)
    const assertion = await authenticator.getAssertion(await loginOptions(), { origin: ORIGIN })

    expect((await post('/login/verify', assertion)).status).toBe(200)
    const replayed = await post('/login/verify', assertion)

    expect(replayed.status).toBe(400)
    expect(replayed.body).toMatchObject({
      error: expect.stringMatching(
        /^Custom challenge verifier returned false for registration response challenge "[A-Za-z0-9_-]{43}"$/,
      ),
    })
  })

  it('refuses an assertion from another origin of the same RP ID', async () => {
    const authenticator = await SoftwareAuthenticator.create({ credentialId: credentialIdOf(0x33) })
    await registerThroughWorker(authenticator)

    const answer = await post(
      '/login/verify',
      await authenticator.getAssertion(await loginOptions(), {
        origin: 'https://evil.cms.example.test',
      }),
    )

    expect(answer).toEqual({
      status: 400,
      body: {
        error:
          'Unexpected authentication response origin "https://evil.cms.example.test", expected "https://cms.example.test"',
      },
    })
  })

  it('answers 401 verified: false for a signature of another key', async () => {
    const authenticator = await SoftwareAuthenticator.create({ credentialId: credentialIdOf(0x44) })
    await registerThroughWorker(authenticator)
    const impostor = await SoftwareAuthenticator.create({ credentialId: credentialIdOf(0x44) })

    const answer = await post(
      '/login/verify',
      await impostor.getAssertion(await loginOptions(), { origin: ORIGIN }),
    )

    expect(answer).toEqual({ status: 401, body: { verified: false } })
  })

  it('refuses a credential it never registered', async () => {
    const stranger = await SoftwareAuthenticator.create({ credentialId: credentialIdOf(0x55) })
    // A real browser would not sign with a credential outside allowCredentials, so the attacker's
    // client leaves the list out.
    const { allowCredentials: _ignored, ...openOptions } = await loginOptions()

    const answer = await post(
      '/login/verify',
      await stranger.getAssertion(openOptions, { origin: ORIGIN }),
    )

    expect(answer).toEqual({ status: 400, body: { error: 'Unknown credential' } })
  })

  it('refuses a stale counter once two sign-ins were stored: a clone of the authenticator', async () => {
    const authenticator = await SoftwareAuthenticator.create({
      credentialId: credentialIdOf(0x66),
      privateJwk: ES256_PRIVATE_JWK,
    })
    await registerThroughWorker(authenticator)
    for (const newCounter of [1, 2]) {
      const answer = await post(
        '/login/verify',
        await authenticator.getAssertion(await loginOptions(), { origin: ORIGIN }),
      )
      expect(answer.body).toEqual({ verified: true, newCounter })
    }
    // Same credential id and same key, a counter that restarted from 0: the Worker stored 2.
    const clone = await SoftwareAuthenticator.create({
      credentialId: credentialIdOf(0x66),
      privateJwk: ES256_PRIVATE_JWK,
    })

    const answer = await post(
      '/login/verify',
      await clone.getAssertion(await loginOptions(), { origin: ORIGIN }),
    )

    expect(answer).toEqual({
      status: 400,
      body: { error: 'Response counter value 1 was lower than expected 2' },
    })
  })

  it('verifies against the configured origin, whatever host the request came in on', async () => {
    const authenticator = await SoftwareAuthenticator.create({ credentialId: credentialIdOf(0x77) })
    await registerThroughWorker(authenticator)

    // A Worker is reached on its workers.dev host, behind a proxy, in a preview: the request URL is
    // not the origin of the browser, and must not become the expected origin.
    const answer = await post(
      '/login/verify',
      await authenticator.getAssertion(await loginOptions(), { origin: ORIGIN }),
      'https://spike.workers.dev',
    )

    expect(answer).toEqual({ status: 200, body: { verified: true, newCounter: 1 } })
  })

  it('does not register the same passkey twice: its id goes into excludeCredentials', async () => {
    const authenticator = await SoftwareAuthenticator.create({ credentialId: credentialIdOf(0x88) })
    await registerThroughWorker(authenticator)

    const options = (await post('/register/options')).body
    if (!isRegistrationOptions(options)) throw new Error('Unexpected registration options')

    expect(options.excludeCredentials).toContainEqual({
      id: 'iIiIiIiIiIiIiIiIiIiIiA',
      type: 'public-key',
    })
    await expect(authenticator.createCredential(options, { origin: ORIGIN })).rejects.toThrow(
      'InvalidStateError: the credential "iIiIiIiIiIiIiIiIiIiIiA" is in excludeCredentials',
    )
  })

  it('answers GET /runtime and 404 for what it does not serve', async () => {
    const runtime = await exports.default.fetch(`${ORIGIN}/runtime`)

    expect(runtime.status).toBe(200)
    // In this pool the Node.js side is ON (see runtime.workerd.test.ts); the built Worker says
    // undefined / "No such module" here (scripts/e2e-built-worker.ts). The library's
    // `import "reflect-metadata"` has added Reflect.getMetadata in both.
    expect(await runtime.json<object>()).toEqual({
      process: 'object',
      Buffer: 'function',
      setImmediate: 'function',
      require: 'undefined',
      nodeImport: 'importable',
      reflectMetadata: true,
    })
    expect((await exports.default.fetch(`${ORIGIN}/nothing`)).status).toBe(404)
    expect((await exports.default.fetch(`${ORIGIN}/login/verify`)).status).toBe(404)
  })

  it('answers GET /selftest: the library verifies a fixed registration and sign-in with no client', async () => {
    const answer = await exports.default.fetch(`${ORIGIN}/selftest`)

    expect(answer.status).toBe(200)
    expect(await answer.json<object>()).toMatchObject({
      generated: { registrationChallengeLength: 43, authenticationChallengeLength: 43 },
      registration: {
        verified: true,
        fmt: 'none',
        credentialId: 'AQIDBAUGBwgJCgsMDQ4PEA',
        counter: 0,
      },
      authentication: { verified: true, newCounter: 1 },
    })
  })

  it('answers GET /selftest?tamper=signature with verified: false: the route reports the real verdict', async () => {
    const answer = await exports.default.fetch(`${ORIGIN}/selftest?tamper=signature`)

    expect(answer.status).toBe(200)
    expect(await answer.json<object>()).toMatchObject({
      registration: { verified: true },
      authentication: { verified: false, newCounter: 1 },
    })
  })

  it('uses the RP ID of its vars', () => {
    expect(RP_ID).toBe('cms.example.test')
  })
})
