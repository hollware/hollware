import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server'
import {
  SELFTEST_ASSERTION,
  SELFTEST_CHALLENGES,
  SELFTEST_REGISTRATION,
} from './selftest-fixture.ts'

// A spike Worker: it exists to be built, measured and driven. It is the smallest thing that imports
// the library for both verifications. Two diagnostic routes need no client: GET /runtime (which
// Node.js the isolate has) and GET /selftest (the library verifying a fixed registration and
// sign-in, with the same facts in its answer).
//
// The state lives in module memory. The real package keeps challenges in D1 (`auth_challenges`:
// single use, with an expiry) and credentials in `passkeys`, and never in the isolate.
const challenges = new Map<string, 'register' | 'login'>()
const credentials = new Map<string, WebAuthnCredential>()

/** The user id stored on the authenticator: opaque bytes, never an email. */
const USER_ID = new Uint8Array(new TextEncoder().encode('user-0001'))

/** Single use: `Map.delete` is true only the first time, so a challenge cannot be replayed. */
const consumeChallenge = (kind: 'register' | 'login') => (challenge: string) =>
  challenges.get(challenge) === kind && challenges.delete(challenge)

/**
 * Which Node.js this isolate has: the proof that a run is WITHOUT nodejs_compat. The globals (v2 puts
 * process, Buffer and setImmediate there), whether a node: module can be imported (v1 and v2 allow
 * it), and whether the library's `import "reflect-metadata"` added Reflect.getMetadata to the global.
 */
async function runtimeFacts() {
  const scope: Record<string, unknown> = globalThis
  // A variable, so that no bundler tries to resolve it (and fails) in a build without the flag.
  const specifier = 'node:crypto'
  const nodeImport = await import(/* @vite-ignore */ specifier).then(
    () => 'importable',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )
  return {
    process: typeof scope.process,
    Buffer: typeof scope.Buffer,
    setImmediate: typeof scope.setImmediate,
    require: typeof scope.require,
    nodeImport,
    reflectMetadata: 'getMetadata' in Reflect,
  }
}

/**
 * Exercises the library with no client, so that `curl` alone shows it working in the built Worker:
 * both generators, a registration verified (CBOR, authenticator data, SHA-256) and a sign-in verified
 * (JWK import, DER signature, ECDSA verify), all from the fixture of selftest-fixture.ts. It reports
 * the runtime facts in the same answer.
 */
async function selftest(env: Env, tamper: boolean) {
  const registrationOptions = await generateRegistrationOptions({
    rpName: env.RP_NAME,
    rpID: env.RP_ID,
    userName: 'owner@example.test',
    userID: USER_ID,
  })
  const authenticationOptions = await generateAuthenticationOptions({ rpID: env.RP_ID })
  const registration = await verifyRegistrationResponse({
    response: SELFTEST_REGISTRATION,
    expectedChallenge: SELFTEST_CHALLENGES.registration,
    expectedOrigin: env.ORIGIN,
    expectedRPID: env.RP_ID,
  })
  if (!registration.verified) return { error: 'The fixture registration did not verify' }
  // `?tamper=signature` changes one character inside the signature: it must come back unverified.
  const { signature } = SELFTEST_ASSERTION.response
  const response = tamper
    ? {
        ...SELFTEST_ASSERTION,
        response: {
          ...SELFTEST_ASSERTION.response,
          signature: `${signature.slice(0, 20)}${signature[20] === 'A' ? 'B' : 'A'}${signature.slice(21)}`,
        },
      }
    : SELFTEST_ASSERTION
  const authentication = await verifyAuthenticationResponse({
    response,
    expectedChallenge: SELFTEST_CHALLENGES.authentication,
    expectedOrigin: env.ORIGIN,
    expectedRPID: env.RP_ID,
    credential: registration.registrationInfo.credential,
  })
  return {
    ...(await runtimeFacts()),
    generated: {
      registrationChallengeLength: registrationOptions.challenge.length,
      authenticationChallengeLength: authenticationOptions.challenge.length,
    },
    registration: {
      verified: true,
      fmt: registration.registrationInfo.fmt,
      credentialId: registration.registrationInfo.credential.id,
      counter: registration.registrationInfo.credential.counter,
    },
    authentication: {
      verified: authentication.verified,
      newCounter: authentication.authenticationInfo.newCounter,
    },
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url)

  if (request.method === 'GET' && pathname === '/runtime')
    return Response.json(await runtimeFacts())
  if (request.method === 'GET' && pathname === '/selftest') {
    const tamper = new URL(request.url).searchParams.get('tamper') === 'signature'
    return Response.json(await selftest(env, tamper))
  }
  if (request.method !== 'POST') return new Response('Not Found', { status: 404 })

  if (pathname === '/register/options') {
    const options = await generateRegistrationOptions({
      rpName: env.RP_NAME,
      rpID: env.RP_ID,
      userName: 'owner@example.test',
      userID: USER_ID,
      attestationType: 'none',
      // A fresh object per call: the library mutates the one it is given (see the tests).
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      excludeCredentials: [...credentials.keys()].map((id) => ({ id })),
    })
    challenges.set(options.challenge, 'register')
    return Response.json(options)
  }

  if (pathname === '/register/verify') {
    const response = await request.json<RegistrationResponseJSON>()
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: consumeChallenge('register'),
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
    })
    if (!result.verified) return Response.json({ verified: false }, { status: 401 })
    const { credential } = result.registrationInfo
    credentials.set(credential.id, credential)
    return Response.json({
      verified: true,
      credentialId: credential.id,
      counter: credential.counter,
    })
  }

  if (pathname === '/login/options') {
    const options = await generateAuthenticationOptions({
      rpID: env.RP_ID,
      allowCredentials: [...credentials.keys()].map((id) => ({ id })),
      userVerification: 'preferred',
    })
    challenges.set(options.challenge, 'login')
    return Response.json(options)
  }

  if (pathname === '/login/verify') {
    const response = await request.json<AuthenticationResponseJSON>()
    const credential = credentials.get(response.id)
    if (credential === undefined)
      return Response.json({ error: 'Unknown credential' }, { status: 400 })
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: consumeChallenge('login'),
      expectedOrigin: env.ORIGIN,
      expectedRPID: env.RP_ID,
      credential,
    })
    // `verified: false` is a normal return (a bad signature), not a throw: it must be checked.
    if (!result.verified) return Response.json({ verified: false }, { status: 401 })
    credentials.set(credential.id, { ...credential, counter: result.authenticationInfo.newCounter })
    return Response.json({ verified: true, newCounter: result.authenticationInfo.newCounter })
  }

  return new Response('Not Found', { status: 404 })
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env)
    } catch (error) {
      // The library reports a refused ceremony by throwing an Error with a precise message.
      const message = error instanceof Error ? error.message : String(error)
      return Response.json({ error: message }, { status: 400 })
    }
  },
} satisfies ExportedHandler<Env>
