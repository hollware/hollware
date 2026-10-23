import { expect, it } from 'vitest'

import { readBearerToken } from '../../src/auth/bearer.ts'
import { checkHostAndOrigin } from '../../src/auth/guard.ts'
import { insufficientScope, unauthorized } from '../../src/auth/responses.ts'

const TOKEN = `hw_pat_${'0'.repeat(52)}`
const PUBLIC_URL = 'https://cms.example.com'

function requestWith(headers: Record<string, string>, url = 'https://cms.example.com/mcp') {
  return new Request(url, { method: 'POST', headers })
}

async function wire(response: Response | null) {
  if (response === null) return null
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.json(),
  }
}

it('reads the bearer token the way Node does', () => {
  expect(readBearerToken(requestWith({ authorization: `  bearer   ${TOKEN}  ` }))).toBe(TOKEN)
  const inTheUrl = requestWith({}, `https://cms.example.com/mcp?access_token=${TOKEN}`)
  expect(readBearerToken(inTheUrl)).toBeNull()
  const twice = new Headers()
  twice.append('authorization', `Bearer ${TOKEN}`)
  twice.append('authorization', `Bearer ${TOKEN}`)
  expect(readBearerToken(new Request('https://cms.example.com/mcp', { headers: twice }))).toBeNull()
})

it('lets through the host and the origin of the public URL, and nothing else, the way Node does', async () => {
  const through = { host: 'CMS.example.com', origin: 'https://cms.example.com' }
  expect(await wire(checkHostAndOrigin(requestWith(through), PUBLIC_URL))).toBeNull()
  expect(
    await wire(checkHostAndOrigin(requestWith({ host: 'cms.example.com' }), PUBLIC_URL)),
  ).toBeNull()

  const forbiddenHost = {
    status: 403,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json' },
    body: {
      code: 'forbidden_host',
      message: 'The Host header of the request is not the public URL of this Hollware.',
      fix: 'Send the request to https://cms.example.com, the public URL of this Hollware (HOLLWARE_PUBLIC_URL).',
    },
  }
  const wrongHosts: Record<string, string>[] = [
    {},
    { host: 'cms.example.com:8443' },
    { host: 'evil.example.com' },
  ]
  for (const headers of wrongHosts) {
    expect(await wire(checkHostAndOrigin(requestWith(headers), PUBLIC_URL))).toEqual(forbiddenHost)
  }

  const opaque = requestWith({ host: 'cms.example.com', origin: 'null' })
  expect(await wire(checkHostAndOrigin(opaque, PUBLIC_URL))).toMatchObject({
    status: 403,
    body: { code: 'forbidden_origin' },
  })
  const unconfigured = requestWith({ host: 'cms.example.com' })
  expect(await wire(checkHostAndOrigin(unconfigured, undefined))).toMatchObject({
    status: 500,
    body: { code: 'misconfigured' },
  })
})

it('reads the public URL the way Node does', async () => {
  const headers = { host: 'cms.example.com', origin: 'https://cms.example.com' }
  for (const publicUrl of [
    'https://cms.example.com/',
    'https://cms.example.com/mcp?x=1#y',
    'HTTPS://CMS.EXAMPLE.COM',
    '  https://cms.example.com  ',
    'https://cms.example.com:443',
  ]) {
    expect(await wire(checkHostAndOrigin(requestWith(headers), publicUrl))).toBeNull()
  }
  const ipv6 = requestWith({ host: '[::1]:8787', origin: 'http://[::1]:8787' })
  expect(await wire(checkHostAndOrigin(ipv6, 'http://[::1]:8787'))).toBeNull()

  const unusable: unknown[] = [
    '',
    '   ',
    'cms.example.com',
    'cms.example.com:8787',
    '//cms.example.com',
    'https://',
    'ftp://cms.example.com',
    'javascript:alert(1)',
    8787,
    [PUBLIC_URL],
    new URL(PUBLIC_URL),
  ]
  for (const publicUrl of unusable) {
    const answer = await wire(checkHostAndOrigin(requestWith(headers), publicUrl))
    expect(answer).toMatchObject({ status: 500, body: { code: 'misconfigured' } })
  }
})

it('answers 401 and 403 with the same headers as Node does', async () => {
  expect((await wire(unauthorized()))?.headers).toEqual({
    'cache-control': 'no-store',
    'content-type': 'application/json',
    'www-authenticate': 'Bearer realm="hollware"',
  })
  expect((await wire(unauthorized('expired')))?.headers).toEqual({
    'cache-control': 'no-store',
    'content-type': 'application/json',
    'www-authenticate': 'Bearer realm="hollware", error="invalid_token"',
  })
  expect((await wire(insufficientScope(['content:write', 'content:publish'])))?.headers).toEqual({
    'cache-control': 'no-store',
    'content-type': 'application/json',
    'www-authenticate':
      'Bearer realm="hollware", error="insufficient_scope", scope="content:write content:publish"',
  })
})
