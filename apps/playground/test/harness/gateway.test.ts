import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { agentWith, migrate, seedOwnerToken, type Agent } from './support.ts'
import { createHarnessWithoutPublicUrl, createPlaygroundHarness, HOLLWARE_URL } from './workers.ts'

// Fails when: the gateway of the built Hollware Worker (packages/server/src/http, src/auth) stops
// answering what AC-0.1-6 says, as the Worker runs outside the test runner of the server: a request
// for another Host (403 `forbidden_host`) or with another Origin (403 `forbidden_origin`) is
// answered before its token is even looked at, so a valid token does not open it; a request with
// no token (401 `unauthorized` with the Bearer challenge), or with one that is not Hollware's
// (401 with `invalid_token`), is refused; and a deployment that forgot HOLLWARE_PUBLIC_URL answers
// 500 `misconfigured` to everything, `/health` included; the OAuth server stops publishing its
// metadata, or stops taking metadata documents of clients, which it does only with the
// `global_fetch_strictly_public` flag of the built config, or lets clients register themselves. A valid token still works, so none of the
// refusals is an accident of the setup.

const server = createPlaygroundHarness()
let agent: Agent
let token: string

const HEALTH = `${HOLLWARE_URL}/health`

function mcpRequest(url: string, headers: Record<string, string>) {
  return server.fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': 'describe_site',
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'describe_site', arguments: {} },
    }),
  })
}

beforeAll(async () => {
  await server.listen()
  await migrate(server)
  token = await seedOwnerToken(server)
  agent = agentWith(server, token)
})

afterAll(async () => {
  await server.close()
})

describe('the built Hollware Worker', () => {
  it('answers a valid token, and /health at its public URL', async () => {
    const health = await server.fetch(HEALTH)
    const described = await agent.call('describe_site', {})

    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true })
    expect(described.isError).toBe(false)
    expect(described.output).toMatchObject({ outcome: 'ok', site: { key: 'playground' } })
  })

  it('refuses a request for another Host with 403, even with a valid token', async () => {
    const response = await mcpRequest('http://evil.test/mcp', { authorization: `Bearer ${token}` })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'forbidden_host',
      message: 'The Host header of the request is not the public URL of this Hollware.',
      fix: 'Send the request to http://localhost, the public URL of this Hollware (HOLLWARE_PUBLIC_URL).',
    })
  })

  it('refuses a request with another Origin with 403, even with a valid token', async () => {
    const response = await mcpRequest(`${HOLLWARE_URL}/mcp`, {
      authorization: `Bearer ${token}`,
      origin: 'http://evil.test',
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'forbidden_origin',
      message: 'The Origin header of the request is not the public URL of this Hollware.',
      fix: 'Call Hollware from a client that sends no Origin header, or from a page served at http://localhost.',
    })
  })

  it('refuses another Host and another Origin on /health too: the guard is in front of every route', async () => {
    expect((await server.fetch('http://evil.test/health')).status).toBe(403)
    expect((await server.fetch(HEALTH, { headers: { origin: 'http://evil.test' } })).status).toBe(
      403,
    )
  })

  it('answers 401 to /mcp without a token', async () => {
    const response = await mcpRequest(`${HOLLWARE_URL}/mcp`, {})

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer realm="hollware", resource_metadata="${HOLLWARE_URL}/.well-known/oauth-protected-resource/mcp", scope="content:read"`,
    )
    expect(await response.json()).toMatchObject({ code: 'unauthorized' })
  })

  it("answers 401 to a token that is not Hollware's, naming nothing about why", async () => {
    const response = await mcpRequest(`${HOLLWARE_URL}/mcp`, {
      authorization: 'Bearer hw_pat_not-one-of-ours',
    })

    // With the body, and workerd's own log, so that a 500 in CI says which one it is (seen in CI
    // since 2026-10-17, never locally).
    if (response.status !== 401) server.debug()
    expect([response.status, response.status === 401 ? '' : await response.clone().text()]).toEqual(
      [401, ''],
    )
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer realm="hollware", resource_metadata="${HOLLWARE_URL}/.well-known/oauth-protected-resource/mcp", error="invalid_token", scope="content:read"`,
    )
  })
})

describe('the OAuth server of the built Worker', () => {
  it('publishes its metadata, takes metadata documents of clients, and lets none register', async () => {
    const response = await server.fetch(`${HOLLWARE_URL}/.well-known/oauth-authorization-server`)
    const metadata: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(metadata).toMatchObject({
      issuer: HOLLWARE_URL,
      authorization_endpoint: `${HOLLWARE_URL}/authorize`,
      client_id_metadata_document_supported: true,
    })
    expect(metadata).not.toHaveProperty('registration_endpoint')
  })
})

describe('a deployment without HOLLWARE_PUBLIC_URL', () => {
  // Made when its tests start, not when the file is read: a harness made then ran next to the one
  // above while its tests ran, and a request of theirs lost its connection (CI, 2026-10-17).
  let alone: ReturnType<typeof createHarnessWithoutPublicUrl>

  beforeAll(async () => {
    alone = createHarnessWithoutPublicUrl()
    await alone.server.listen()
  })

  afterAll(async () => {
    await alone.server.close()
    alone.remove()
  })

  it('answers 500 to every request, /health included, and says what to set', async () => {
    const health = await alone.server.fetch(HEALTH)
    const mcp = await alone.server.fetch(`${HOLLWARE_URL}/mcp`, { method: 'POST' })

    expect(health.status).toBe(500)
    expect(mcp.status).toBe(500)
    expect(await health.json()).toEqual({
      code: 'misconfigured',
      message: 'HOLLWARE_PUBLIC_URL is required: it is missing, or it is not an http or https URL.',
      fix: 'Set the HOLLWARE_PUBLIC_URL variable of the Worker to its public URL, such as https://cms.example.com, and deploy again.',
    })
  })
})
