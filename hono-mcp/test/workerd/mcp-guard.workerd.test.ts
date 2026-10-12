import { describe, expect, it } from 'vitest'
import app from '../../src/index.ts'

// Fails when: the Host / Origin guard of /mcp (src/mcp/route.ts, ALLOWED_HOSTS) stops answering 403
// to a host or origin outside the list, stops accepting localhost with or without a port, or stops
// being skipped when ALLOWED_HOSTS is empty.

const post = (headers: Record<string, string>, allowedHosts: string) =>
  app.fetch(
    new Request('http://spike.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    }),
    { APP_NAME: 'guard-test', ALLOWED_HOSTS: allowedHosts },
  )

describe('the DNS rebinding guard on /mcp', () => {
  it.each([
    ['no Host header', {}, 'Missing Host header'],
    ['a foreign Host', { host: 'evil.example.com' }, 'Invalid Host: evil.example.com'],
    [
      'a foreign Origin',
      { host: 'localhost', origin: 'http://evil.example.com' },
      'Invalid Origin: evil.example.com',
    ],
  ])('answers 403 to %s', async (_label, headers, message) => {
    const response = await post(headers, 'localhost,127.0.0.1,[::1]')

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32000, message },
      id: null,
    })
  })

  it.each([
    ['localhost', {}],
    ['localhost with a port', { host: 'localhost:5201' }],
    ['an uppercase host', { host: 'LOCALHOST' }],
    ['IPv6 loopback with a port', { host: '[::1]:8787' }],
    ['a local origin on another port', { host: 'localhost', origin: 'http://localhost:3000' }],
  ])('lets %s through', async (_label, headers) => {
    const response = await post({ host: 'localhost', ...headers }, 'localhost,127.0.0.1,[::1]')

    expect(response.status).toBe(200)
  })

  it('skips the guard when ALLOWED_HOSTS is empty', async () => {
    const response = await post({ host: 'evil.example.com' }, '')

    expect(response.status).toBe(200)
  })
})
