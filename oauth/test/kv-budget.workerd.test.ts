import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authorize,
  bearer,
  codeOf,
  PKCE_VERIFIER,
  REDIRECT_URI,
  register,
  tokenRequest,
  type Send,
  type TokenResponse,
} from './support/oauth.ts'

// The KV cost of the flow (OAUTH_KV, the free plan allows 1,000 writes a day). Fails when: the
// provider changes how many KV reads, writes, deletes and lists a step costs.

const send: Send = (input, init) => exports.default.fetch(input, init)
const base = 'https://hollware.test'

afterEach(() => {
  vi.restoreAllMocks()
})

function watchKv() {
  const spies = {
    get: vi.spyOn(env.OAUTH_KV, 'get'),
    put: vi.spyOn(env.OAUTH_KV, 'put'),
    delete: vi.spyOn(env.OAUTH_KV, 'delete'),
    list: vi.spyOn(env.OAUTH_KV, 'list'),
  }
  /** What happened since the last call. */
  return () => {
    const counted = {
      get: spies.get.mock.calls.length,
      put: spies.put.mock.calls.length,
      delete: spies.delete.mock.calls.length,
      list: spies.list.mock.calls.length,
    }
    for (const spy of Object.values(spies)) spy.mockClear()
    return counted
  }
}

describe('KV operations per step of the OAuth flow', () => {
  it('costs 4 writes and 1 list to sign a client in, 1 read per API call, 2 writes per refresh', async () => {
    const taken = watchKv()

    const client = await register(send, base)
    expect(taken()).toEqual({ get: 0, put: 1, delete: 0, list: 0 })

    const approved = await authorize(send, base, {
      clientId: client.client_id,
      scope: 'content:read',
      resource: base,
    })
    expect(taken()).toEqual({ get: 2, put: 1, delete: 0, list: 1 })

    const exchanged = await tokenRequest(send, base, {
      grant_type: 'authorization_code',
      code: codeOf(approved),
      redirect_uri: REDIRECT_URI,
      client_id: client.client_id,
      code_verifier: PKCE_VERIFIER,
      resource: base,
    })
    const tokens = await exchanged.json<TokenResponse>()
    expect(taken()).toEqual({ get: 2, put: 2, delete: 0, list: 0 })

    await send(`${base}/mcp`, bearer(tokens.access_token))
    expect(taken()).toEqual({ get: 1, put: 0, delete: 0, list: 0 })

    await tokenRequest(send, base, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: client.client_id,
    })
    expect(taken()).toEqual({ get: 2, put: 2, delete: 0, list: 0 })

    await tokenRequest(send, base, {
      token: tokens.access_token,
      token_type_hint: 'access_token',
      client_id: client.client_id,
    })
    expect(taken()).toEqual({ get: 2, put: 0, delete: 1, list: 0 })
  })

  it('costs a personal token no KV operation at all', async () => {
    const taken = watchKv()

    await send(`${base}/mcp`, bearer('hw_pat_test'))

    expect(taken()).toEqual({ get: 0, put: 0, delete: 0, list: 0 })
  })
})
