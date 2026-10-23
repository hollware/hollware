import { describe, expect, it } from 'vite-plus/test'

import { previewCookieClear, previewHeaders, previewRedirect } from '../src/index.ts'

const TOKEN = 'hw_prv_AAAA.BBBB'
const CLEARED = 'hollware_preview=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'

function get(url: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Request(url, { method, headers })
}

describe('previewRedirect', () => {
  it('answers the link with a 303, the cookie, no cache and no Referer', () => {
    const answer = previewRedirect(get(`https://site.test/blog/a?x=1&hollware-preview=${TOKEN}`))

    expect(answer?.status).toBe(303)
    expect(answer?.headers.get('location')).toMatch(
      /^\/blog\/a\?x=1&hollware-view=[A-Za-z0-9_-]{12}$/,
    )
    expect(answer?.headers.get('set-cookie')).toBe(
      `hollware_preview=${TOKEN}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`,
    )
    expect(answer?.headers.get('cache-control')).toBe('no-store')
    expect(answer?.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('leaves the cookie Secure off on http://localhost only', () => {
    const local = previewRedirect(get(`http://localhost:5173/p?hollware-preview=${TOKEN}`))
    const other = previewRedirect(get(`http://site.test/p?hollware-preview=${TOKEN}`))

    expect(local?.headers.get('set-cookie')).toBe(
      `hollware_preview=${TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`,
    )
    expect(other?.headers.get('set-cookie')).toContain(' Secure;')
  })

  it('redirects a value that is not shaped like a token, with no cookie', () => {
    const answer = previewRedirect(get('https://site.test/p?hollware-preview=nonsense'))

    expect(answer?.status).toBe(303)
    expect(answer?.headers.get('location')).toBe('/p')
    expect(answer?.headers.get('set-cookie')).toBeNull()
  })

  it('is null for a request with no link, and for a method that is not a read', () => {
    expect(previewRedirect(get('https://site.test/p'))).toBeNull()
    expect(
      previewRedirect(get(`https://site.test/p?hollware-preview=${TOKEN}`, {}, 'POST')),
    ).toBeNull()
    expect(
      previewRedirect(get(`https://site.test/p?hollware-preview=${TOKEN}`, {}, 'HEAD'))?.status,
    ).toBe(303)
  })
})

describe('previewCookieClear', () => {
  const request = get('https://site.test/p')

  it('clears the cookie for a refusal, over the binding or HTTP, through its cause', () => {
    const refusal = Object.assign(new Error('expired'), { code: 'invalid_preview' })

    expect(previewCookieClear(refusal, request)).toBe(CLEARED)
    expect(previewCookieClear(new Error('x', { cause: refusal }), request)).toBe(CLEARED)
  })

  it('leaves it for any other error, which is no refusal of the token', () => {
    expect(previewCookieClear(new Error('boom'), request)).toBeNull()
    expect(
      previewCookieClear(Object.assign(new Error('x'), { code: 'not_found' }), request),
    ).toBeNull()
    expect(previewCookieClear(undefined, request)).toBeNull()
  })
})

describe('previewHeaders', () => {
  const withToken = get('https://site.test/p', { cookie: `a=1; hollware_preview=${TOKEN}` })

  it('is no-store for a visitor with a token', () => {
    const headers = previewHeaders(withToken)

    expect(headers.get('cache-control')).toBe('no-store')
    expect(headers.get('set-cookie')).toBeNull()
  })

  it('clears the cookie too when Hollware refused the token', () => {
    const refusal = Object.assign(new Error('expired'), { code: 'invalid_preview' })

    expect(previewHeaders(withToken, refusal).get('set-cookie')).toBe(CLEARED)
    expect(previewHeaders(withToken, new Error('boom')).get('set-cookie')).toBeNull()
  })

  it('is empty for a visitor with no token, or with a value that is not one', () => {
    const none = [...previewHeaders(get('https://site.test/p'))]
    const bad = [...previewHeaders(get('https://site.test/p', { cookie: 'hollware_preview=x' }))]

    expect([none, bad]).toEqual([[], []])
  })
})
