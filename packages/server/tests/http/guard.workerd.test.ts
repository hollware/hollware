import { generatePersonalToken } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { seedToken } from '../auth/support.ts'
import { boot, SITE_KEY, wire, type SendOptions } from './support.ts'

const HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
}

const MISCONFIGURED_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
}

const MISCONFIGURED = {
  status: 500,
  headers: MISCONFIGURED_HEADERS,
  body: {
    code: 'misconfigured',
    message: 'HOLLWARE_PUBLIC_URL is required: it is missing, or it is not an http or https URL.',
    fix: 'Set the HOLLWARE_PUBLIC_URL variable of the Worker to its public URL, such as https://cms.example.com, and deploy again.',
  },
}

const FORBIDDEN_HOST = {
  status: 403,
  headers: HEADERS,
  body: {
    code: 'forbidden_host',
    message: 'The Host header of the request is not the public URL of this Hollware.',
    fix: 'Send the request to https://hollware.test, the public URL of this Hollware (HOLLWARE_PUBLIC_URL).',
  },
}

const FORBIDDEN_ORIGIN = {
  status: 403,
  headers: HEADERS,
  body: {
    code: 'forbidden_origin',
    message: 'The Origin header of the request is not the public URL of this Hollware.',
    fix: 'Call Hollware from a client that sends no Origin header, or from a page served at https://hollware.test.',
  },
}

const ROUTES: readonly (readonly [string, string, string])[] = [
  ['/health', 'GET', 'health'],
  ['/mcp', 'POST', 'the MCP endpoint'],
  ['/nowhere', 'GET', 'a path with no route'],
]

const REFUSALS: readonly {
  readonly name: string
  readonly publicUrl?: string | null
  readonly send: SendOptions
  readonly answer: typeof MISCONFIGURED
}[] = [
  { name: 'no HOLLWARE_PUBLIC_URL', publicUrl: null, send: {}, answer: MISCONFIGURED },
  {
    name: 'a HOLLWARE_PUBLIC_URL that is no URL',
    publicUrl: 'hollware.test',
    send: {},
    answer: MISCONFIGURED,
  },
  {
    name: 'a HOLLWARE_PUBLIC_URL of another scheme',
    publicUrl: 'ftp://hollware.test',
    send: {},
    answer: MISCONFIGURED,
  },
  { name: 'another Host', send: { host: 'evil.test' }, answer: FORBIDDEN_HOST },
  { name: 'no Host', send: { host: null }, answer: FORBIDDEN_HOST },
  {
    name: 'the Host with another port',
    send: { host: 'hollware.test:8787' },
    answer: FORBIDDEN_HOST,
  },
  {
    name: 'another Origin',
    send: { headers: { origin: 'http://evil.test' } },
    answer: FORBIDDEN_ORIGIN,
  },
  {
    name: 'the Origin of another scheme',
    send: { headers: { origin: 'http://hollware.test' } },
    answer: FORBIDDEN_ORIGIN,
  },
  { name: 'the opaque Origin', send: { headers: { origin: 'null' } }, answer: FORBIDDEN_ORIGIN },
]

function bootWith(publicUrl: string | null | undefined) {
  if (publicUrl === undefined) return boot()
  return boot({ publicUrl: publicUrl === null ? undefined : publicUrl })
}

describe('the guard in front of every route', () => {
  for (const [path, method, route] of ROUTES) {
    it.each(REFUSALS)(`answers $name before ${route}`, async ({ publicUrl, send, answer }) => {
      const worker = bootWith(publicUrl)

      const response = await worker.send(path, {
        method,
        body: method === 'POST' ? '{}' : undefined,
        ...send,
      })

      expect(await wire(response)).toEqual(answer)
      expect(worker.seen).toEqual([])
      expect(worker.queries).toEqual([])
      expect(worker.sessions).toEqual([])
    })
  }

  it('does not look at the token of a request for another host', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, { expiresAt: '2026-11-11T12:00:00.000Z' })
    const worker = boot()

    const response = await worker.send('/mcp', {
      method: 'POST',
      body: '{}',
      host: 'evil.test',
      token: seeded.token,
    })
    const unknownToken = await worker.send('/mcp', {
      method: 'POST',
      body: '{}',
      host: 'evil.test',
      token: generatePersonalToken(),
    })

    expect(await wire(response)).toEqual(FORBIDDEN_HOST)
    expect(await wire(unknownToken)).toEqual(FORBIDDEN_HOST)
    expect(worker.queries).toEqual([])
    expect(worker.waited).toEqual([])
  })

  it('lets through the Host and the Origin of the public URL, whatever their case', async () => {
    const worker = boot()

    const plain = await worker.send('/health')
    const shouting = await worker.send('/health', {
      host: 'HOLLWARE.TEST',
      headers: { origin: 'HTTPS://Hollware.Test' },
    })

    expect(await wire(plain)).toEqual({ status: 200, headers: HEADERS, body: { ok: true } })
    expect(await wire(shouting)).toEqual({ status: 200, headers: HEADERS, body: { ok: true } })
  })
})
