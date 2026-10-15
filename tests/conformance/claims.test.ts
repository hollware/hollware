import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { isPersonalToken } from '../../packages/core/src/tokens.ts'
import { probeClaims, type Era } from './claims.ts'
import { freePort } from './processes.ts'

// Fails when: a probe stops passing against a Worker that keeps the claim, or stops failing when its
// own claim breaks: the public Host refused, the Host check or the Origin check gone alone, a
// refusal with the wrong status or the wrong code, the 401 for a missing token or for an unknown
// token gone, with the wrong status or the wrong realm, the 403 for a missing scope gone, with the
// wrong status or a challenge that names no scope, any of the three without the protected resource
// metadata of `/mcp`, a granted scope refused, served with the wrong
// status, with an error or with no result; the answers of the Worker stop being read, as JSON and
// as a server-sent event; the requests of an era stop carrying what the era requires (the
// `Mcp-Method` and `Mcp-Name` headers and the `_meta` envelope of 2026-07-28, the protocol header of
// 2025-11-25); a probe throws, instead of failing, when the Worker is not there.

const PUBLIC_HOST = '127.0.0.1:4242'
const READ_ONLY = 'hw_pat_0123456789abcdefghjkmnpqrstvwxyz0123456789abcdefghjk'

const IDS = [
  'public-host-is-accepted',
  'host-check-rejects-a-foreign-host',
  'origin-check-rejects-a-foreign-origin',
  'no-token-is-401-with-challenge',
  'unknown-token-is-401-invalid-token',
  'missing-scope-is-403-with-challenge',
  'granted-scope-is-served',
]

/** The ways a Worker can break the claims. Each one turns the probes it names red, and no other. */
interface Faults {
  /** The Host check is gone. */
  skipHostCheck?: boolean
  /** The Origin check is gone. */
  skipOriginCheck?: boolean
  /** A request to the public Host is refused. */
  refuseHealth?: boolean
  /** The refusals of the Host, the Origin and the scope are 400, with the right bodies. */
  refusalsAre400?: boolean
  /** The refusals of the Host and the Origin are 403, with a code of no one's. */
  wrongRefusalCodes?: boolean
  /** A request without a token goes through. */
  skipTokenCheck?: boolean
  /** A token nobody issued is accepted. */
  acceptAnyToken?: boolean
  /** The 401s are 403, with the right challenge. */
  unauthorizedIs403?: boolean
  /** The challenge of a 401 names another realm. */
  wrongRealm?: boolean
  /** No challenge names the protected resource metadata. */
  noResourceMetadata?: boolean
  /** The scope of a tool is not checked. */
  skipScopeCheck?: boolean
  /** The 403 for a missing scope names no scope. */
  challengeWithoutScope?: boolean
  /** Every call of a tool is refused with 403, the granted ones too. */
  refuseEveryCall?: boolean
  /** A granted call is served with 200 and a result that is an error. */
  grantedCallIsAnError?: boolean
  /** A granted call is served with 200 and no result. */
  grantedCallHasNoResult?: boolean
  /** A granted call is served with 202 and a result that is not an error. */
  grantedStatusIs202?: boolean
}

interface Seen {
  readonly method: string | undefined
  readonly url: string | undefined
  readonly headers: IncomingMessage['headers']
  readonly body: unknown
}

/** A Worker that answers as `packages/server` documents, but for the faults it is given. */
async function fakeWorker(faults: Faults = {}) {
  const seen: Seen[] = []
  const json = (
    response: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) => {
    response.writeHead(status, { 'content-type': 'application/json', ...headers })
    response.end(JSON.stringify(body))
  }
  const refusal = faults.refusalsAre400 === true ? 400 : 403
  const unauthorized = faults.unauthorizedIs403 === true ? 403 : 401
  const metadata =
    faults.noResourceMetadata === true
      ? 'resource_metadata="none"'
      : `resource_metadata="http://${PUBLIC_HOST}/.well-known/oauth-protected-resource/mcp"`
  const realm = faults.wrongRealm === true ? 'Bearer realm="other"' : 'Bearer realm="hollware"'
  const server = createServer((incoming, response) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      const body: unknown = text === '' ? undefined : JSON.parse(text)
      seen.push({ method: incoming.method, url: incoming.url, headers: incoming.headers, body })
      const publicOrigin = `http://${PUBLIC_HOST}`
      if (faults.skipHostCheck !== true && incoming.headers.host !== PUBLIC_HOST) {
        json(response, refusal, {
          code: faults.wrongRefusalCodes === true ? 'forbidden' : 'forbidden_host',
        })
        return
      }
      const origin = incoming.headers.origin
      if (faults.skipOriginCheck !== true && origin !== undefined && origin !== publicOrigin) {
        json(response, refusal, {
          code: faults.wrongRefusalCodes === true ? 'forbidden' : 'forbidden_origin',
        })
        return
      }
      if (incoming.method === 'GET' && incoming.url === '/health') {
        json(response, faults.refuseHealth === true ? 503 : 200, { ok: true })
        return
      }
      const credentials = incoming.headers.authorization
      const token = credentials?.startsWith('Bearer ')
        ? credentials.slice('Bearer '.length)
        : undefined
      if (token === undefined && faults.skipTokenCheck !== true) {
        json(
          response,
          unauthorized,
          { code: 'unauthorized' },
          { 'www-authenticate': `${realm}, ${metadata}, scope="content:read"` },
        )
        return
      }
      if (token !== undefined && token !== READ_ONLY && faults.acceptAnyToken !== true) {
        json(
          response,
          unauthorized,
          { code: 'unauthorized' },
          {
            'www-authenticate': `${realm}, ${metadata}, error="invalid_token", scope="content:read"`,
          },
        )
        return
      }
      const call =
        typeof body === 'object' && body !== null && 'params' in body ? body.params : undefined
      const tool =
        typeof call === 'object' && call !== null && 'name' in call ? String(call.name) : undefined
      if (
        faults.refuseEveryCall === true ||
        (tool === 'create_draft' && faults.skipScopeCheck !== true)
      ) {
        json(
          response,
          refusal,
          { error: 'insufficient_scope' },
          {
            'www-authenticate':
              faults.challengeWithoutScope === true
                ? 'Bearer error="insufficient_scope"'
                : `Bearer error="insufficient_scope", error_description="create_draft requires: content:write", scope="content:write", ${metadata}`,
          },
        )
        return
      }
      const message =
        faults.grantedCallHasNoResult === true
          ? { jsonrpc: '2.0', id: 1 }
          : {
              jsonrpc: '2.0',
              id: 1,
              result: { isError: faults.grantedCallIsAnError === true, content: [] },
            }
      const status = faults.grantedStatusIs202 === true ? 202 : 200
      // The answer comes as JSON to a request of 2026-07-28, which carries `Mcp-Method`, and as a
      // server-sent event to one of 2025-11-25, so that the probes read both forms.
      if (incoming.headers['mcp-method'] !== undefined) {
        json(response, status, message)
        return
      }
      response.writeHead(status, { 'content-type': 'text/event-stream' })
      response.end(`event: message\ndata: ${JSON.stringify(message)}\n\n`)
    })
  })
  const port = await freePort()
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  stops.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
        server.closeAllConnections()
      }),
  )
  return { port, seen }
}

/** A Worker that takes every request and never answers it. */
async function silentWorker(): Promise<number> {
  const server = createServer(() => {})
  const port = await freePort()
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  stops.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
        server.closeAllConnections()
      }),
  )
  return port
}

const stops: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()))
})

async function probe(port: number, era: Era = 'modern') {
  const results = await probeClaims({
    workerPort: port,
    publicUrl: `http://${PUBLIC_HOST}`,
    era,
    readOnlyToken: READ_ONLY,
  })
  return Object.fromEntries(results.map((result) => [result.id, result]))
}

/** The ids of the probes that failed. */
async function failed(faults: Faults, era: Era = 'modern'): Promise<string[]> {
  const { port } = await fakeWorker(faults)
  const results = await probe(port, era)
  return IDS.filter((id) => results[id]?.status !== 'SUCCESS')
}

describe('the probes of what the suite cannot see', () => {
  it('pass against a Worker that keeps every claim, in both eras', async () => {
    expect(await failed({}, 'modern')).toEqual([])
    expect(await failed({}, 'legacy')).toEqual([])
  })

  it('give the probes of the scenario in the order the profile names them', async () => {
    const { port } = await fakeWorker()
    const results = await probeClaims({
      workerPort: port,
      publicUrl: `http://${PUBLIC_HOST}`,
      era: 'modern',
      readOnlyToken: READ_ONLY,
    })
    expect(results.map((result) => result.id)).toEqual(IDS)
  })

  describe('when a claim breaks', () => {
    it('fail the control when the public Host is refused', async () => {
      expect(await failed({ refuseHealth: true })).toEqual(['public-host-is-accepted'])
    })

    it('fail the Host probe, and only it, when the Worker stops checking the Host', async () => {
      expect(await failed({ skipHostCheck: true })).toEqual(['host-check-rejects-a-foreign-host'])
    })

    it('fail the Origin probe, and only it, when the Worker stops checking the Origin', async () => {
      expect(await failed({ skipOriginCheck: true })).toEqual([
        'origin-check-rejects-a-foreign-origin',
      ])
    })

    it('fail the three refusals that are not 403', async () => {
      expect(await failed({ refusalsAre400: true })).toEqual([
        'host-check-rejects-a-foreign-host',
        'origin-check-rejects-a-foreign-origin',
        'missing-scope-is-403-with-challenge',
      ])
    })

    it('fail the Host and Origin probes when the refusal has no code of the check', async () => {
      expect(await failed({ wrongRefusalCodes: true })).toEqual([
        'host-check-rejects-a-foreign-host',
        'origin-check-rejects-a-foreign-origin',
      ])
    })

    it('fail the 401 probe when a request without a token gets through', async () => {
      expect(await failed({ skipTokenCheck: true })).toEqual(['no-token-is-401-with-challenge'])
    })

    it('fail the 401 probe when a token nobody issued is accepted', async () => {
      expect(await failed({ acceptAnyToken: true })).toEqual(['unknown-token-is-401-invalid-token'])
    })

    it('fail both 401 probes when the status is 403', async () => {
      expect(await failed({ unauthorizedIs403: true })).toEqual([
        'no-token-is-401-with-challenge',
        'unknown-token-is-401-invalid-token',
      ])
    })

    it('fail both 401 probes when the challenge names another realm', async () => {
      expect(await failed({ wrongRealm: true })).toEqual([
        'no-token-is-401-with-challenge',
        'unknown-token-is-401-invalid-token',
      ])
    })

    it('fail the 401 and 403 probes when no challenge names the protected resource metadata', async () => {
      expect(await failed({ noResourceMetadata: true })).toEqual([
        'no-token-is-401-with-challenge',
        'unknown-token-is-401-invalid-token',
        'missing-scope-is-403-with-challenge',
      ])
    })

    it('fail the 403 probe when the scope of a tool is not checked', async () => {
      expect(await failed({ skipScopeCheck: true })).toEqual([
        'missing-scope-is-403-with-challenge',
      ])
    })

    it('fail the 403 probe when the challenge does not name the missing scope', async () => {
      expect(await failed({ challengeWithoutScope: true })).toEqual([
        'missing-scope-is-403-with-challenge',
      ])
    })

    it('fail the control of the granted scope when the Worker refuses every call', async () => {
      // The 403 probe passes too, which is why the control exists: a Worker that refuses
      // everything must not look as if it checks scopes.
      expect(await failed({ refuseEveryCall: true })).toEqual(['granted-scope-is-served'])
    })

    it('fail the control of the granted scope when it is served with another status', async () => {
      expect(await failed({ grantedStatusIs202: true })).toEqual(['granted-scope-is-served'])
    })

    it('fail the control of the granted scope when the result is an error', async () => {
      expect(await failed({ grantedCallIsAnError: true })).toEqual(['granted-scope-is-served'])
    })

    it('fail the control of the granted scope when there is no result', async () => {
      expect(await failed({ grantedCallHasNoResult: true })).toEqual(['granted-scope-is-served'])
    })
  })

  it('says what the Worker answered instead, in the check that failed', async () => {
    const { port } = await fakeWorker({ skipScopeCheck: true })
    const results = await probe(port)
    expect(results['missing-scope-is-403-with-challenge']).toMatchObject({
      status: 'FAILURE',
      errorMessage: `expected 403, got 200; expected www-authenticate: Bearer error="insufficient_scope", error_description="create_draft requires: content:write", scope="content:write", resource_metadata="http://${PUBLIC_HOST}/.well-known/oauth-protected-resource/mcp", got none`,
    })
    expect(results['public-host-is-accepted']).toMatchObject({
      status: 'SUCCESS',
      errorMessage: undefined,
    })
  })

  it('says which code the Worker sent instead of the one of the check', async () => {
    const { port } = await fakeWorker({ wrongRefusalCodes: true })
    const results = await probe(port)
    expect(results['host-check-rejects-a-foreign-host']?.errorMessage).toBe(
      'expected code forbidden_host, got forbidden',
    )
    expect(results['origin-check-rejects-a-foreign-origin']?.errorMessage).toBe(
      'expected code forbidden_origin, got forbidden',
    )
  })

  it('gives up on a Worker that never answers, and says how long it waited', async () => {
    const results = await probeClaims({
      workerPort: await silentWorker(),
      publicUrl: `http://${PUBLIC_HOST}`,
      era: 'modern',
      readOnlyToken: READ_ONLY,
      timeoutMs: 50,
    })
    expect(results.map((result) => result.errorMessage)).toEqual(
      Array.from({ length: IDS.length }, () => 'the request failed: no answer within 50 ms'),
    )
  })

  it('describes each check, for the checks.json that the runner writes', async () => {
    const { port } = await fakeWorker()
    const results = await probe(port)
    expect(results['host-check-rejects-a-foreign-host']).toMatchObject({
      name: 'host-check-rejects-a-foreign-host',
      description: 'A request with a foreign Host and no Origin is refused with 403 forbidden_host',
    })
  })

  it('fails every probe instead of throwing when the Worker is not there', async () => {
    const results = await probe(await freePort())
    expect(IDS.map((id) => results[id]?.status)).toEqual(
      Array.from({ length: IDS.length }, () => 'FAILURE'),
    )
    expect(results['public-host-is-accepted']?.errorMessage).toContain('the request failed')
  })

  describe('the requests of an era', () => {
    it('are the ones of 2026-07-28: the method and the name in headers, the envelope in _meta', async () => {
      const { port, seen } = await fakeWorker()
      await probe(port, 'modern')
      const call = seen.find(
        (request) =>
          request.url === '/mcp' && request.headers.authorization === `Bearer ${READ_ONLY}`,
      )
      expect(call?.headers['mcp-protocol-version']).toBe('2026-07-28')
      expect(call?.headers['mcp-method']).toBe('tools/call')
      expect(call?.headers['mcp-name']).toBe('create_draft')
      expect(call?.body).toMatchObject({
        method: 'tools/call',
        params: {
          name: 'create_draft',
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'conformance-claims', version: '0.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      })
    })

    it('are the ones of 2025-11-25: the protocol header, and neither Mcp-Method nor _meta', async () => {
      const { port, seen } = await fakeWorker()
      await probe(port, 'legacy')
      const call = seen.find(
        (request) =>
          request.url === '/mcp' && request.headers.authorization === `Bearer ${READ_ONLY}`,
      )
      expect(call?.headers['mcp-protocol-version']).toBe('2025-11-25')
      expect(call?.headers['mcp-method']).toBeUndefined()
      expect(call?.headers['mcp-name']).toBeUndefined()
      expect(JSON.stringify(call?.body)).not.toContain('_meta')
    })

    it('are these seven, in this order, with these Hosts, Origins, tokens and tools', async () => {
      const { port, seen } = await fakeWorker()
      await probe(port)
      const sent = seen.map((request) => {
        const bearer = request.headers.authorization?.slice('Bearer '.length)
        const call = request.body
        const params =
          typeof call === 'object' && call !== null && 'params' in call ? call.params : undefined
        const tool =
          typeof params === 'object' && params !== null && 'name' in params
            ? params.name
            : undefined
        return [
          request.method,
          request.url,
          request.headers.host,
          request.headers.origin,
          bearer === undefined
            ? 'no token'
            : bearer === READ_ONLY
              ? 'read-only token'
              : 'unknown token',
          tool,
        ]
      })
      expect(sent).toEqual([
        ['GET', '/health', PUBLIC_HOST, undefined, 'no token', undefined],
        ['GET', '/health', 'evil.example.com', undefined, 'no token', undefined],
        ['GET', '/health', PUBLIC_HOST, 'http://evil.example.com', 'no token', undefined],
        ['POST', '/mcp', PUBLIC_HOST, undefined, 'no token', 'create_draft'],
        ['POST', '/mcp', PUBLIC_HOST, undefined, 'unknown token', 'create_draft'],
        ['POST', '/mcp', PUBLIC_HOST, undefined, 'read-only token', 'create_draft'],
        ['POST', '/mcp', PUBLIC_HOST, undefined, 'read-only token', 'describe_site'],
      ])
    })

    it('send a token of the right shape that nobody was issued, and the draft of the Worker config', async () => {
      const { port, seen } = await fakeWorker()
      await probe(port)
      const unknown = seen.find(
        (request) =>
          request.headers.authorization !== undefined &&
          request.headers.authorization !== `Bearer ${READ_ONLY}`,
      )
      const bearer = unknown?.headers.authorization?.slice('Bearer '.length) ?? ''
      expect(isPersonalToken(bearer)).toBe(true)
      expect(bearer).not.toBe(READ_ONLY)
      expect(unknown?.body).toMatchObject({
        params: {
          name: 'create_draft',
          arguments: {
            collection: 'notes',
            locale: 'en',
            slug: 'claims-probe',
            markdown:
              '---\ntitle: Claims probe\n---\n\nA draft that a token without content:write must not make.\n',
          },
        },
      })
    })
  })
})
