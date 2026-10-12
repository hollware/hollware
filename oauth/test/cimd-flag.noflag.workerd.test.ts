import { exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorize, wire, type Send } from './support/oauth.ts'

// O6, the flag. Fails when: the provider stops refusing CIMD, and stops advertising it, in a
// Worker that does not have the global_fetch_strictly_public compatibility flag.

const send: Send = (input, init) => exports.default.fetch(input, init)
const base = 'https://hollware.test'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Client ID Metadata Documents without global_fetch_strictly_public', () => {
  it('runs without the flag', () => {
    expect(Cloudflare.compatibilityFlags.global_fetch_strictly_public).toBe(false)
  })

  it('stops advertising CIMD and private_key_jwt, although the provider enables it', async () => {
    const response = await send(`${base}/.well-known/oauth-authorization-server`)

    const metadata = await response.json<Record<string, unknown>>()
    expect(metadata.client_id_metadata_document_supported).toBe(false)
    expect(metadata.token_endpoint_auth_methods_supported).toEqual([
      'client_secret_basic',
      'client_secret_post',
      'none',
    ])
    expect(metadata).not.toHaveProperty('token_endpoint_auth_signing_alg_values_supported')
  })

  it('fails /authorize for a URL client_id with a plain Error (a 500), before any fetch', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const web = vi.spyOn(globalThis, 'fetch')

    const response = await authorize(send, base, {
      clientId: 'https://agent.example/oauth/client.json',
      scope: 'content:read',
      resource: base,
    })

    expect(await wire(response)).toMatchObject({ status: 500, body: 'Internal Server Error' })
    expect(web).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0]?.[0])).toContain(
      "CIMD is enabled but 'global_fetch_strictly_public' compatibility flag is not set.",
    )
  })
})
