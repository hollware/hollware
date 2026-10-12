// CPU cost of @simplewebauthn/server 14.0.3 verifications, measured in Node 24 (not in workerd:
// inside workerd Date.now() and performance.now() do not advance during synchronous work).
//
//   node bench/cpu.ts                     warm: 500 warm-up calls, then 3 runs of 3000 timed calls
//   node bench/cpu.ts --runs 3 --iterations 3000 --warmup 500
//   node bench/cpu.ts --cold              the first call of each function in THIS fresh process
//
// Per function it prints, for each run, the median and p95 of the wall time of one `await call`,
// and the CPU time of the whole process per call (user + system, from process.cpuUsage()), which
// also counts the libuv threads that run WebCrypto in Node. In workerd the same WebCrypto work runs
// on the isolate's thread, so the CPU figure is the closer one to what a request is billed.
// Run it three times and keep the lowest median: other agents load this machine while it runs.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { performance } from 'node:perf_hooks'
import {
  CHALLENGE_BYTES,
  CREDENTIAL_ID,
  ES256_PRIVATE_JWK,
  ORIGIN,
  OTHER_CHALLENGE_BYTES,
  RP_ID,
  RP_NAME,
  USER_ID,
  USER_NAME,
} from '../test/support/fixtures.ts'
import type { AuthenticatorAlgorithm } from '../test/support/software-authenticator.ts'
import { SoftwareAuthenticator } from '../test/support/software-authenticator.ts'

const args = process.argv.slice(2)
const option = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : Number(args[index + 1])
}
const iterations = option('iterations', 3000)
const warmup = option('warmup', 500)
const runs = option('runs', 3)
const cold = args.includes('--cold')

/**
 * Everything a verification needs, from one registration and one sign-in. It never calls a
 * `verify...` function: with --cold the first call of each must be the one that is timed.
 */
async function fixtureFor(algorithm: AuthenticatorAlgorithm) {
  const authenticator = await SoftwareAuthenticator.create({
    credentialId: CREDENTIAL_ID,
    algorithm,
    ...(algorithm === 'ES256' ? { privateJwk: ES256_PRIVATE_JWK } : {}),
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
  })
  const authenticationOptions = await generateAuthenticationOptions({
    rpID: RP_ID,
    challenge: OTHER_CHALLENGE_BYTES,
  })
  const assertion = await authenticator.getAssertion(authenticationOptions, { origin: ORIGIN })
  // What verifyRegistrationResponse would hand back to store: id, COSE public key, counter 0.
  const credential = {
    id: registrationResponse.id,
    publicKey: authenticator.cosePublicKey,
    counter: 0,
  }
  return { registrationOptions, registrationResponse, authenticationOptions, assertion, credential }
}

const es256 = await fixtureFor('ES256')
const eddsa = await fixtureFor('EdDSA')
const rs256 = await fixtureFor('RS256')

const verifyRegistration = () =>
  verifyRegistrationResponse({
    response: es256.registrationResponse,
    expectedChallenge: es256.registrationOptions.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  })
const verifyAuthentication = (fixture: typeof es256) => () =>
  verifyAuthenticationResponse({
    response: fixture.assertion,
    expectedChallenge: fixture.authenticationOptions.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: fixture.credential,
  })

// The ES256 public key, and what a verification does to it, with no library around it.
const jwk = { kty: 'EC', crv: 'P-256', x: ES256_PRIVATE_JWK.x, y: ES256_PRIVATE_JWK.y, ext: false }
const rawSignature = new Uint8Array(64).fill(1)
const message = new Uint8Array(37 + 32).fill(2)
const rawWebCryptoVerify = async () => {
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, rawSignature, message)
}

type Case = {
  name: string
  required: boolean
  call: () => Promise<unknown>
  expect?: (result: never) => boolean
}
const cases: Case[] = [
  { name: 'verifyRegistrationResponse  (ES256, "none")', required: true, call: verifyRegistration },
  {
    name: 'verifyAuthenticationResponse (ES256)',
    required: true,
    call: verifyAuthentication(es256),
  },
  {
    name: 'verifyAuthenticationResponse (EdDSA)',
    required: false,
    call: verifyAuthentication(eddsa),
  },
  {
    name: 'verifyAuthenticationResponse (RS256 2048)',
    required: false,
    call: verifyAuthentication(rs256),
  },
  {
    name: 'generateRegistrationOptions',
    required: false,
    call: () => generateRegistrationOptions({ rpName: RP_NAME, rpID: RP_ID, userName: USER_NAME }),
  },
  {
    name: 'generateAuthenticationOptions',
    required: false,
    call: () => generateAuthenticationOptions({ rpID: RP_ID }),
  },
  {
    name: 'reference: raw WebCrypto importKey + ECDSA verify',
    required: false,
    call: rawWebCryptoVerify,
  },
]

const stats = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? NaN
  return {
    median: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    min: sorted[0] ?? NaN,
    max: sorted.at(-1) ?? NaN,
  }
}
const ms = (value: number) => `${value.toFixed(3)} ms`

if (cold) {
  // The first call of each required function in a fresh process: lazy compilation and first use of
  // everything. The fixtures above already used `crypto.subtle` (digest, sign) and the options
  // generators, but no `verify...` function. One line of JSON for the caller to collect.
  const first: Record<string, number> = {}
  for (const testCase of cases.filter((candidate) => candidate.required)) {
    const start = performance.now()
    await testCase.call()
    first[testCase.name.trim()] = performance.now() - start
  }
  console.log(JSON.stringify(first))
} else {
  console.log(
    `node ${process.version}, ${process.platform}/${process.arch}, ${iterations} timed calls x ${runs} runs after ${warmup} warm-up calls`,
  )
  for (const testCase of cases) {
    const result = await testCase.call()
    if (
      testCase.required &&
      typeof result === 'object' &&
      result !== null &&
      'verified' in result &&
      result.verified !== true
    ) {
      throw new Error(`${testCase.name} did not verify`)
    }
    for (let index = 0; index < warmup; index++) await testCase.call()
    const lines: string[] = []
    const medians: number[] = []
    for (let run = 1; run <= runs; run++) {
      const samples: number[] = []
      const cpuStart = process.cpuUsage()
      for (let index = 0; index < iterations; index++) {
        const start = performance.now()
        await testCase.call()
        samples.push(performance.now() - start)
      }
      const cpu = process.cpuUsage(cpuStart)
      const summary = stats(samples)
      medians.push(summary.median)
      lines.push(
        `    run ${run}: median ${ms(summary.median)}  p95 ${ms(summary.p95)}  p99 ${ms(summary.p99)}  min ${ms(summary.min)}  max ${ms(summary.max)}  process CPU/call ${ms((cpu.user + cpu.system) / 1000 / iterations)}`,
      )
    }
    console.log(
      `${testCase.required ? '*' : ' '} ${testCase.name}  -> lowest median ${ms(Math.min(...medians))}`,
    )
    for (const line of lines) console.log(line)
  }
}
