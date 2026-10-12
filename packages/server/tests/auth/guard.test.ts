import { describe, expect, it } from 'vite-plus/test'

import { checkHostAndOrigin } from '../../src/auth/guard.ts'

// Fails when: checkHostAndOrigin (src/auth/guard.ts) lets a request through whose Host is not the
// host of the public URL (case aside), port included, or refuses that host with the default port
// of its scheme written out; or lets a request through whose Origin is present and is not its
// origin, scheme and port included, `null` and empty ones with it; stops reading `Host` and
// `Origin` as whole values (a prefix, a suffix, credentials or a path would pass); returns
// something other than `null` for a request that may go on; skips the check, or answers anything
// but 500, when HOLLWARE_PUBLIC_URL is missing or is not an absolute http(s) URL; takes the host
// from X-Forwarded-Host or Forwarded, which a page after DNS rebinding can set; or repeats a header
// of the request in an answer.

const PUBLIC_URL = 'https://cms.example.com'

function requestWith(headers: Record<string, string>): Request {
  return new Request('https://cms.example.com/mcp', { method: 'POST', headers })
}

async function wire(response: Response | null) {
  if (response === null) return null
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.json(),
  }
}

const JSON_HEADERS = { 'cache-control': 'no-store', 'content-type': 'application/json' }

const HOST_REFUSED = {
  status: 403,
  headers: JSON_HEADERS,
  body: {
    code: 'forbidden_host',
    message: 'The Host header of the request is not the public URL of this Hollware.',
    fix: 'Send the request to https://cms.example.com, the public URL of this Hollware (HOLLWARE_PUBLIC_URL).',
  },
}

const ORIGIN_REFUSED = {
  status: 403,
  headers: JSON_HEADERS,
  body: {
    code: 'forbidden_origin',
    message: 'The Origin header of the request is not the public URL of this Hollware.',
    fix: 'Call Hollware from a client that sends no Origin header, or from a page served at https://cms.example.com.',
  },
}

const NOT_CONFIGURED = {
  status: 500,
  headers: JSON_HEADERS,
  body: {
    code: 'misconfigured',
    message: 'HOLLWARE_PUBLIC_URL is required: it is missing, or it is not an http or https URL.',
    fix: 'Set the HOLLWARE_PUBLIC_URL variable of the Worker to its public URL, such as https://cms.example.com, and deploy again.',
  },
}

describe('checkHostAndOrigin: the Host', () => {
  it.each<[string, Record<string, string>]>([
    ['the host', { host: 'cms.example.com' }],
    ['the host in capitals', { host: 'CMS.Example.COM' }],
    [
      'the host with an origin that is the public one',
      {
        host: 'cms.example.com',
        origin: 'https://cms.example.com',
      },
    ],
    [
      'the host with that origin in capitals',
      {
        host: 'cms.example.com',
        origin: 'HTTPS://CMS.EXAMPLE.COM',
      },
    ],
    // Some clients write the default port of the scheme out; it names the same server.
    ['the host with the default port of its scheme written out', { host: 'cms.example.com:443' }],
  ])('lets a request through with %s', async (_label, headers) => {
    expect(await wire(checkHostAndOrigin(requestWith(headers), PUBLIC_URL))).toBeNull()
  })

  it.each<[string, Record<string, string>]>([
    ['no Host', {}],
    ['an empty Host', { host: '' }],
    ['a foreign host', { host: 'evil.example.com' }],
    [
      'the right host on a port, which the MCP SDK helper lets through',
      { host: 'cms.example.com:8443' },
    ],
    // An https URL's default port is 443; port 80 written out is another server.
    ['the right host with the default port of the other scheme', { host: 'cms.example.com:80' }],
    // After DNS rebinding the page is same-origin and may set any header a browser lets it set.
    // `Host` and `Origin` it cannot; `X-Forwarded-Host` and `Forwarded` it can, so they count for nothing.
    [
      'a foreign host that says the right one in X-Forwarded-Host',
      { host: 'evil.example.com', 'x-forwarded-host': 'cms.example.com' },
    ],
    ['no Host, and the right one in X-Forwarded-Host', { 'x-forwarded-host': 'cms.example.com' }],
    [
      'a foreign host that says the right one in Forwarded',
      { host: 'evil.example.com', forwarded: 'host=cms.example.com' },
    ],
    ['a host that starts with the right one', { host: 'cms.example.com.evil.com' }],
    ['a host that ends with the right one', { host: 'evil-cms.example.com' }],
    [
      'the right host with credentials, which the MCP SDK helper lets through',
      { host: 'user@cms.example.com' },
    ],
    [
      'the right host with a path, which the MCP SDK helper lets through',
      { host: 'cms.example.com/mcp' },
    ],
    [
      'a foreign host that comes with the right origin',
      {
        host: 'evil.example.com',
        origin: 'https://cms.example.com',
      },
    ],
    [
      'a foreign host that comes with a foreign origin',
      {
        host: 'evil.example.com',
        origin: 'https://evil.example.com',
      },
    ],
  ])('answers 403 to %s, without repeating it', async (_label, headers) => {
    expect(await wire(checkHostAndOrigin(requestWith(headers), PUBLIC_URL))).toEqual(HOST_REFUSED)
  })
})

describe('checkHostAndOrigin: the Origin', () => {
  it.each([
    ['the opaque origin "null"', 'null'],
    ['an empty Origin', ''],
    ['a foreign origin', 'https://evil.example.com'],
    ['the right host over http, which the MCP SDK helper lets through', 'http://cms.example.com'],
    [
      'the right host on a port, which the MCP SDK helper lets through',
      'https://cms.example.com:8443',
    ],
    ['the origin with a trailing slash', 'https://cms.example.com/'],
    [
      'the origin with a path, which the MCP SDK helper lets through',
      'https://cms.example.com/path',
    ],
    [
      'the origin with credentials, which the MCP SDK helper lets through',
      'https://user@cms.example.com',
    ],
    ['an origin that starts with the right one', 'https://cms.example.com.evil.com'],
    ['an origin that ends with the right one', 'https://evil-cms.example.com'],
  ])('answers 403 to %s, without repeating it', async (_label, origin) => {
    const request = requestWith({ host: 'cms.example.com', origin })
    expect(await wire(checkHostAndOrigin(request, PUBLIC_URL))).toEqual(ORIGIN_REFUSED)
  })
})

describe('checkHostAndOrigin: a public URL with a port', () => {
  const LOCAL = 'http://localhost:8787'
  const HOST_REFUSED_LOCAL = {
    ...HOST_REFUSED,
    body: {
      ...HOST_REFUSED.body,
      fix: 'Send the request to http://localhost:8787, the public URL of this Hollware (HOLLWARE_PUBLIC_URL).',
    },
  }
  const ORIGIN_REFUSED_LOCAL = {
    ...ORIGIN_REFUSED,
    body: {
      ...ORIGIN_REFUSED.body,
      fix: 'Call Hollware from a client that sends no Origin header, or from a page served at http://localhost:8787.',
    },
  }

  it('lets through the host and the origin with that port', async () => {
    const headers = { host: 'localhost:8787', origin: 'http://localhost:8787' }
    expect(await wire(checkHostAndOrigin(requestWith(headers), LOCAL))).toBeNull()
  })

  it('lets through an IPv6 address in brackets, with its port, and no other port', async () => {
    const headers = { host: '[::1]:8787', origin: 'http://[::1]:8787' }
    expect(await wire(checkHostAndOrigin(requestWith(headers), 'http://[::1]:8787'))).toBeNull()
    const other = await wire(
      checkHostAndOrigin(requestWith({ host: '[::1]:8788' }), 'http://[::1]:8787'),
    )
    expect(other?.status).toBe(403)
  })

  it.each([
    ['no port', 'localhost'],
    ['another port', 'localhost:8788'],
    ['the default port of the scheme', 'localhost:80'],
    ['another name for the same machine', '127.0.0.1:8787'],
  ])('answers 403 to a Host with %s', async (_label, host) => {
    expect(await wire(checkHostAndOrigin(requestWith({ host }), LOCAL))).toEqual(HOST_REFUSED_LOCAL)
  })

  it.each([
    ['no port', 'http://localhost'],
    ['another port', 'http://localhost:8788'],
    ['another scheme', 'https://localhost:8787'],
  ])('answers 403 to an Origin with %s', async (_label, origin) => {
    const request = requestWith({ host: 'localhost:8787', origin })
    expect(await wire(checkHostAndOrigin(request, LOCAL))).toEqual(ORIGIN_REFUSED_LOCAL)
  })
})

describe('checkHostAndOrigin: the public URL', () => {
  it.each([
    ['a trailing slash', 'https://cms.example.com/'],
    ['a path, a query and a fragment', 'https://cms.example.com/mcp?x=1#y'],
    ['capitals', 'HTTPS://CMS.EXAMPLE.COM'],
    ['spaces around it', '  https://cms.example.com  '],
    ['the default port written out', 'https://cms.example.com:443'],
  ])('is the same host and origin with %s', async (_label, publicUrl) => {
    const headers = { host: 'cms.example.com', origin: 'https://cms.example.com' }
    expect(await wire(checkHostAndOrigin(requestWith(headers), publicUrl))).toBeNull()
    const foreign = { host: 'evil.example.com' }
    expect((await wire(checkHostAndOrigin(requestWith(foreign), publicUrl)))?.status).toBe(403)
  })

  it.each<[string, unknown]>([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['blank', '   '],
    ['a host without a scheme', 'cms.example.com'],
    ['a host and a port without a scheme', 'cms.example.com:8787'],
    ['a URL without a scheme', '//cms.example.com'],
    ['a URL without a host', 'https://'],
    ['not a web URL', 'ftp://cms.example.com'],
    ['a script', 'javascript:alert(1)'],
    ['a number', 8787],
    ['an object', { url: PUBLIC_URL }],
    // Both would read as the public URL if they were turned into text.
    ['an array with the URL in it', [PUBLIC_URL]],
    ['a URL object', new URL(PUBLIC_URL)],
  ])('answers 500 when it is %s, whatever the request says', async (_label, publicUrl) => {
    const perfect = { host: 'cms.example.com', origin: 'https://cms.example.com' }
    const attacker = { host: 'attacker.example', origin: 'https://attacker.example' }
    for (const headers of [perfect, attacker, {}]) {
      expect(await wire(checkHostAndOrigin(requestWith(headers), publicUrl))).toEqual(
        NOT_CONFIGURED,
      )
    }
  })
})
