import { describe, expect, it } from 'vite-plus/test'

import {
  clearedPreviewCookie,
  exchangeHeaders,
  exchangePreviewLink,
  isPreviewRefusal,
  isPreviewToken,
  isSecureRequest,
  previewCookie,
  previewTokenFromCookie,
} from '../src/preview.ts'
import { HollwareClientError } from '../src/index.ts'

// Fails when: the exchange of a preview link (src/preview.ts) redirects to another host through a
// path that starts with // or /\, or stops dropping `hollware-preview`
// and keeping every other parameter in order, keeps a value that is not shaped like a token,
// gives the cookie other flags than HttpOnly, Secure (off on http://localhost and 127.0.0.1),
// SameSite=Lax, Path=/ and an hour, reads a cookie that is not its own, or clears the cookie for
// anything but an expired or invalid token.

const TOKEN = 'hw_prv_eyJzIjoicyJ9.c2ln-_9'

describe('the exchange of a preview link', () => {
  it('drops the parameter and keeps the others in order', () => {
    expect(
      exchangePreviewLink(
        `https://site.test/en/blog/x/?a=1&hollware-preview=${TOKEN}&b=%20`,
        () => 'N0nce',
      ),
    ).toEqual({
      location: '/en/blog/x/?a=1&b=%20&hollware-view=N0nce',
      token: TOKEN,
    })
  })

  it('leaves no question mark when nothing else is left', () => {
    expect(
      exchangePreviewLink(
        new URL(`https://site.test/blog/x?hollware-preview=${TOKEN}`),
        () => 'N0nce',
      ),
    ).toEqual({
      location: '/blog/x?hollware-view=N0nce',
      token: TOKEN,
    })
  })

  it('redirects to a path of this site, never to the host a path with // or /\\ names (T-103)', () => {
    const where = (path: string) =>
      exchangePreviewLink(`https://site.test${path}?hollware-preview=x`)?.location

    expect([where('//evil.example/x'), where('/\\evil.example/x'), where('/blog/x')]).toEqual([
      '/evil.example/x',
      '/evil.example/x',
      '/blog/x',
    ])
  })

  it('has no exchange for a URL without the parameter', () => {
    expect(exchangePreviewLink('https://site.test/blog/x?a=1&preview=2')).toBeUndefined()
  })

  it('drops a value that is not shaped like a token, and still redirects', () => {
    const urls = [
      'https://site.test/p?hollware-preview=hw_prv_nonsense',
      'https://site.test/p?hollware-preview=',
      'https://site.test/p?hollware-preview',
      'https://site.test/p?hollware-preview=hw_prv_a.b;Path=/',
      'https://site.test/p?hollware-preview=hw_prv_a.b%0d%0aSet-Cookie:x=1',
    ]

    expect(urls.map((url) => exchangePreviewLink(url))).toEqual(
      urls.map(() => ({ location: '/p', token: undefined })),
    )
  })

  it('takes the first of two parameters and drops both', () => {
    expect(
      exchangePreviewLink(
        `https://site.test/p?hollware-preview=${TOKEN}&hollware-preview=hw_prv_a.b`,
        () => 'N0nce',
      ),
    ).toEqual({ location: '/p?hollware-view=N0nce', token: TOKEN })
  })
})

describe('the preview cookie', () => {
  it('keeps the token for an hour with the flags that protect it', () => {
    expect(previewCookie(TOKEN, { secure: true })).toBe(
      `hollware_preview=${TOKEN}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`,
    )
  })

  it('is not Secure only on http://localhost and http://127.0.0.1', () => {
    expect(previewCookie(TOKEN, { secure: false })).toBe(
      `hollware_preview=${TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`,
    )
    expect(
      [
        'http://localhost:4321/a',
        'http://127.0.0.1/a',
        'https://localhost/a',
        'http://site.test/a',
        'https://site.test/a',
      ].map((url) => isSecureRequest(url)),
    ).toEqual([false, false, true, true, true])
  })

  it('is cleared with Max-Age=0', () => {
    expect(clearedPreviewCookie({ secure: true })).toBe(
      'hollware_preview=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    )
  })

  it('is read from a Cookie header, and only when it is shaped like a token', () => {
    expect(previewTokenFromCookie(`a=1; hollware_preview=${TOKEN}; b=2`)).toBe(TOKEN)
    expect(previewTokenFromCookie(`xhollware_preview=${TOKEN}`)).toBeUndefined()
    expect(previewTokenFromCookie('hollware_preview=hw_prv_nonsense')).toBeUndefined()
    expect(previewTokenFromCookie('a=1')).toBeUndefined()
    expect(previewTokenFromCookie(null)).toBeUndefined()
  })

  it('goes with a 303 that keeps nothing and tells no one where it came from', () => {
    const exchange = exchangePreviewLink(
      `https://site.test/p?x=1&hollware-preview=${TOKEN}`,
      () => 'N0nce',
    )!

    expect(exchangeHeaders(exchange, 'https://site.test/p')).toEqual([
      ['location', '/p?x=1&hollware-view=N0nce'],
      ['cache-control', 'no-store'],
      ['referrer-policy', 'no-referrer'],
      [
        'set-cookie',
        `hollware_preview=${TOKEN}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`,
      ],
    ])
    expect(exchangeHeaders({ location: '/p', token: undefined }, 'https://site.test/p')).toEqual([
      ['location', '/p'],
      ['cache-control', 'no-store'],
      ['referrer-policy', 'no-referrer'],
    ])
  })
})

describe('a refusal of a preview token', () => {
  it('is the code invalid_preview, however the error arrives', () => {
    const http = new HollwareClientError(
      400,
      'invalid_preview',
      'This preview link has expired.',
      null,
    )
    const wrapped = new Error('Hollware answered 400', {
      cause: Object.assign(new Error('This preview link is not valid.'), {
        code: 'invalid_preview',
      }),
    })

    expect([isPreviewRefusal(http), isPreviewRefusal(wrapped)]).toEqual([true, true])
  })

  it('is not another error, a missing secret or no error', () => {
    expect(
      [
        new Error('boom'),
        new Error(
          'This Hollware cannot check preview links: it has no HOLLWARE_SECRET of 32 characters or more.',
        ),
        'This preview link has expired.',
        // The words alone are not a refusal: only the code is.
        Object.assign(new Error('This preview link has expired.'), { code: 'invalid_input' }),
        undefined,
      ].map((error) => isPreviewRefusal(error)),
    ).toEqual([false, false, false, false, false])
  })
})

describe('isPreviewToken', () => {
  it('wants the prefix, a payload and a signature of base64url', () => {
    expect(
      [
        TOKEN,
        'hw_prv_a.b',
        'hw_prv_.b',
        'hw_prv_a.',
        'hw_prv_a',
        'hw_read_a.b',
        'hw_prv_a.b.c',
        'hw_prv_a+b.c',
        7,
      ].map((value) => isPreviewToken(value)),
    ).toEqual([true, true, false, false, false, false, false, false, false])
  })
})
