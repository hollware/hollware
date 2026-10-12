// The whole ceremony against the BUILT Worker, running in plain workerd (wrangler dev) with Node.js
// compatibility off. The Vitest pool cannot prove that: it switches Node.js compat on by itself.
//
//   scripts/with-dev-server.sh 5240 /runtime "-c dist/hollware_spike_auth/wrangler.json" -- \
//     node scripts/e2e-built-worker.ts off
//
// The first argument is what `GET /runtime` must say about Node.js: `off` (process and Buffer
// undefined) or `on` (the nodejs_compat build). The optional second one, `pruned`, is for the builds
// of vite.stub-attestation.config.ts, which no longer load reflect-metadata. SPIKE_URL is set by
// with-dev-server.sh.

import assert from 'node:assert/strict'
import {
  CREDENTIAL_ID,
  CREDENTIAL_ID_B64U,
  ES256_PRIVATE_JWK,
  fromBase64Url,
  toBase64Url,
} from '../test/support/fixtures.ts'
import { SoftwareAuthenticator } from '../test/support/software-authenticator.ts'

const baseUrl = process.env.SPIKE_URL
if (baseUrl === undefined)
  throw new Error('SPIKE_URL is not set: run this through scripts/with-dev-server.sh')
const expectNodeCompat = process.argv[2] === 'on'
const expectReflectMetadata = process.argv[3] !== 'pruned'
// The origin the "browser" is on. The Worker's vars say https://cms.example.test; the server
// itself is reached at http://127.0.0.1:<port>, which the browser would never use for a passkey.
const ORIGIN = 'https://cms.example.test'

type Reply = { status: number; body: unknown }
async function reply(response: Response): Promise<Reply> {
  return { status: response.status, body: await response.json() }
}
const get = async (path: string) => reply(await fetch(`${baseUrl}${path}`))
const post = async (path: string, body?: unknown) =>
  reply(
    await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )

function expectOptions<T extends object>(reply: Reply, key: string): T {
  assert.equal(reply.status, 200)
  assert.ok(typeof reply.body === 'object' && reply.body !== null && key in reply.body)
  return reply.body as T
}

type CreationOptions = Parameters<SoftwareAuthenticator['createCredential']>[0]
type RequestOptions = Parameters<SoftwareAuthenticator['getAssertion']>[0]
type Assertion = Awaited<ReturnType<SoftwareAuthenticator['getAssertion']>>

const register = async (authenticator: SoftwareAuthenticator) =>
  post(
    '/register/verify',
    await authenticator.createCredential(
      expectOptions<CreationOptions>(await post('/register/options'), 'pubKeyCredParams'),
      { origin: ORIGIN },
    ),
  )
const loginOptions = async () => expectOptions<RequestOptions>(await post('/login/options'), 'rpId')
const login = async (
  authenticator: SoftwareAuthenticator,
  options?: RequestOptions,
  origin = ORIGIN,
) => authenticator.getAssertion(options ?? (await loginOptions()), { origin })

let steps = 0
const ok = (message: string) => console.log(`  ok ${++steps}  ${message}`)

// 1. Which Node.js does this isolate have? Globals AND importable node: modules: v2 gives both,
// v1 only the modules, so "off" means neither. workerd says `No such module "node:crypto".`; the
// Vite dev server's module runner (`vp dev`) says `Cannot find module 'node:crypto' imported from ...`.
function expectRuntime(body: unknown): Record<string, unknown> {
  const { nodeImport, ...rest } = body as { nodeImport: string }
  const { process, Buffer, setImmediate, require, reflectMetadata, ...others } = rest as Record<
    string,
    unknown
  >
  assert.deepEqual(
    { process, Buffer, setImmediate, require, reflectMetadata },
    {
      process: expectNodeCompat ? 'object' : 'undefined',
      Buffer: expectNodeCompat ? 'function' : 'undefined',
      setImmediate: expectNodeCompat ? 'function' : 'undefined',
      require: 'undefined',
      reflectMetadata: expectReflectMetadata,
    },
  )
  if (expectNodeCompat) assert.equal(nodeImport, 'importable')
  else
    assert.match(
      nodeImport,
      /^(No such module "node:crypto"\.|Cannot find module 'node:crypto' imported from )/,
    )
  return others
}

const runtime = await get('/runtime')
assert.equal(runtime.status, 200)
assert.deepEqual(expectRuntime(runtime.body), {})
const facts = runtime.body as {
  process: string
  Buffer: string
  setImmediate: string
  nodeImport: string
}
ok(
  `GET /runtime: typeof process ${facts.process}, Buffer ${facts.Buffer}, setImmediate ${facts.setImmediate}, import("node:crypto") ${facts.nodeImport.slice(0, 40)}`,
)

// The library exercised by the Worker itself (no client), with the runtime facts in the same answer:
// the answer to "does the library run in this isolate, and does the isolate have Node.js?".
const selftest = await get('/selftest')
assert.equal(selftest.status, 200)
assert.deepEqual(expectRuntime(selftest.body), {
  generated: { registrationChallengeLength: 43, authenticationChallengeLength: 43 },
  registration: { verified: true, fmt: 'none', credentialId: CREDENTIAL_ID_B64U, counter: 0 },
  authentication: { verified: true, newCounter: 1 },
})
const selftestFacts = selftest.body as { process: string }
ok(
  `GET /selftest: library verified a registration and a sign-in, typeof globalThis.process ${selftestFacts.process}`,
)

// The same route with one character of the signature changed: it must say "not verified", so that
// the route cannot "pass" by reporting true whatever the library says.
const tampered = await get('/selftest?tamper=signature')
assert.equal(tampered.status, 200)
assert.deepEqual(expectRuntime(tampered.body), {
  generated: { registrationChallengeLength: 43, authenticationChallengeLength: 43 },
  registration: { verified: true, fmt: 'none', credentialId: CREDENTIAL_ID_B64U, counter: 0 },
  authentication: { verified: false, newCounter: 1 },
})
ok('GET /selftest?tamper=signature: authentication.verified false')

// 2. Registration and two sign-ins with the fixed ES256 passkey.
const authenticator = await SoftwareAuthenticator.create({
  credentialId: CREDENTIAL_ID,
  privateJwk: ES256_PRIVATE_JWK,
})
assert.deepEqual(await register(authenticator), {
  status: 200,
  body: { verified: true, credentialId: CREDENTIAL_ID_B64U, counter: 0 },
})
ok('POST /register/options + /register/verify: ES256 passkey stored, counter 0')

const firstAssertion = await login(authenticator)
assert.deepEqual(await post('/login/verify', firstAssertion), {
  status: 200,
  body: { verified: true, newCounter: 1 },
})
ok('POST /login/options + /login/verify: verified, newCounter 1')
assert.deepEqual(await post('/login/verify', await login(authenticator)), {
  status: 200,
  body: { verified: true, newCounter: 2 },
})
ok('second sign-in: verified, newCounter 2')

// 3. What the library refuses, through the Worker.
const replayed = await post('/login/verify', firstAssertion)
assert.equal(replayed.status, 400)
assert.match(
  String((replayed.body as { error: string }).error),
  /^Custom challenge verifier returned false for registration response challenge "[A-Za-z0-9_-]{43}"$/,
)
ok(`the same assertion again: 400, ${(replayed.body as { error: string }).error}`)

assert.deepEqual(
  await post(
    '/login/verify',
    await login(authenticator, undefined, 'https://evil.cms.example.test'),
  ),
  {
    status: 400,
    body: {
      error:
        'Unexpected authentication response origin "https://evil.cms.example.test", expected "https://cms.example.test"',
    },
  },
)
ok(
  'wrong origin: 400, Unexpected authentication response origin "https://evil.cms.example.test", expected "https://cms.example.test"',
)

const wrongRp = { ...(await loginOptions()), rpId: 'example.test' }
assert.deepEqual(await post('/login/verify', await login(authenticator, wrongRp)), {
  status: 400,
  body: { error: 'Unexpected RP ID hash' },
})
ok('wrong RP ID: 400, Unexpected RP ID hash')

const staleCounter = await SoftwareAuthenticator.create({
  credentialId: CREDENTIAL_ID,
  privateJwk: ES256_PRIVATE_JWK,
  signCount: 0,
})
assert.deepEqual(await post('/login/verify', await login(staleCounter)), {
  status: 400,
  body: { error: 'Response counter value 1 was lower than expected 2' },
})
ok('replay with a stale counter: 400, Response counter value 1 was lower than expected 2')

const flipBit = (assertion: Assertion): Assertion => {
  const signature = fromBase64Url(assertion.response.signature)
  signature[10] = (signature[10] ?? 0) ^ 1
  return { ...assertion, response: { ...assertion.response, signature: toBase64Url(signature) } }
}
assert.deepEqual(await post('/login/verify', flipBit(await login(authenticator))), {
  status: 401,
  body: { verified: false },
})
ok('signature changed by one bit: 401, verified: false (no throw)')

// Its counter must be ahead of the stored one (3), or the counter check refuses it before the signature.
const impostor = await SoftwareAuthenticator.create({ credentialId: CREDENTIAL_ID, signCount: 10 })
assert.deepEqual(await post('/login/verify', await login(impostor)), {
  status: 401,
  body: { verified: false },
})
ok('signature of another key: 401, verified: false')

const brokenDer = await login(authenticator)
brokenDer.response.signature = toBase64Url(
  Uint8Array.of(0x31, ...fromBase64Url(brokenDer.response.signature).subarray(1)),
)
const brokenReply = await post('/login/verify', brokenDer)
assert.equal(brokenReply.status, 400)
// The library builds this message from a class name (`${target.name}`), so a minifier renames it:
// "ECDSASigValue" in an unminified build, a short identifier such as "Vl" in a minified one.
assert.match(
  String((brokenReply.body as { error: string }).error),
  /^Data does not match to \w+ ASN1 schema\.$/,
)
ok(`a signature that is not DER: 400, ${(brokenReply.body as { error: string }).error}`)

// 4. The other two algorithms the default pubKeyCredParams offer, in the built Worker.
for (const [algorithm, seed] of [
  ['EdDSA', 0x71],
  ['RS256', 0x72],
] as const) {
  const other = await SoftwareAuthenticator.create({
    credentialId: new Uint8Array(16).fill(seed),
    algorithm,
  })
  assert.equal((await register(other)).status, 200)
  assert.deepEqual(await post('/login/verify', await login(other)), {
    status: 200,
    body: { verified: true, newCounter: 1 },
  })
  ok(`${algorithm} passkey: registered and signed in, newCounter 1`)
}

console.log(
  `\n${steps} checks passed against ${baseUrl} (Node.js compat ${expectNodeCompat ? 'on' : 'off'})`,
)
