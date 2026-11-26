import { describe, expect, it } from 'vite-plus/test'

import { canonicalRedirectOf } from '../server/utils/canonical.ts'

const of = (url: string) => canonicalRedirectOf(new URL(url))

describe('the one URL of a page', () => {
  it('sends www to the apex, keeping the path and the query', () => {
    expect(of('https://www.hollware.com/docs/cli/?a=1')).toBe('https://hollware.com/docs/cli/?a=1')
  })

  it('ends the path of a page with a slash, in both languages', () => {
    expect(of('https://hollware.com/docs/cli')).toBe('https://hollware.com/docs/cli/')
    expect(of('https://hollware.com/es')).toBe('https://hollware.com/es/')
    expect(of('https://www.hollware.com/features?x=1')).toBe('https://hollware.com/features/?x=1')
  })

  it('leaves files, internal routes and canonical pages alone', () => {
    for (const url of [
      'https://hollware.com/',
      'https://hollware.com/es/docs/cli/',
      'https://hollware.com/docs/cli.md',
      'https://hollware.com/sitemap.xml',
      'https://hollware.com/llms.txt',
      'https://hollware.com/_hollware/webhook',
      'https://hollware.com/__nuxt_error',
      'http://localhost:3000/features/',
    ]) {
      expect(of(url), url).toBeNull()
    }
  })
})
