import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

const PUBLIC_HOST = 'localhost:5199'

const asHost = (host: string) => ({ headers: { host } })

describe('the playground Worker over HTTP', () => {
  it('answers GET /health at its public URL', async () => {
    const response = await exports.default.fetch(
      `http://${PUBLIC_HOST}/health`,
      asHost(PUBLIC_HOST),
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"ok":true}')
  })

  it('refuses a request for another Host, and says which URL to use', async () => {
    const response = await exports.default.fetch(
      'http://playground.test/health',
      asHost('playground.test'),
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'forbidden_host',
      message: 'The Host header of the request is not the public URL of this Hollware.',
      fix: 'Send the request to http://localhost:5199, the public URL of this Hollware (HOLLWARE_PUBLIC_URL).',
    })
  })

  it('answers 401 to /mcp without a token', async () => {
    const response = await exports.default.fetch(`http://${PUBLIC_HOST}/mcp`, {
      method: 'POST',
      ...asHost(PUBLIC_HOST),
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer realm="hollware", resource_metadata="http://localhost:5199/.well-known/oauth-protected-resource/mcp", scope="content:read"',
    )
    expect(await response.json()).toMatchObject({ code: 'unauthorized' })
  })
})
