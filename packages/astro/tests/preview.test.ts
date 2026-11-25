import { describe, expect, it } from 'vite-plus/test'

import { hollwarePreview, previewResponse } from '../src/preview.ts'

describe('a page read with a preview token', () => {
  it('is no-store even when the response the page got has headers that cannot change', () => {
    const page = Response.redirect('https://blog.example/blog/', 302)

    const answer = previewResponse(page, false, new URL('https://blog.example/blog/hola/'))

    expect([answer.status, answer.headers.get('cache-control')]).toEqual([302, 'no-store'])
  })
})

describe('hollwarePreview with an embedded preview', () => {
  const TOKEN = 'hw_prv_AAAA.BBBB'

  async function through(url: string, cookie?: string) {
    const locals: Record<string, unknown> = {}
    const request = new Request(url, cookie === undefined ? {} : { headers: { cookie } })
    const context = { request, url: new URL(url), locals }
    const answer: Response = await Reflect.apply(hollwarePreview(), undefined, [
      context,
      () => Promise.resolve(new Response('page')),
    ])
    return { answer, locals }
  }

  it('renders in place with the token of the URL, kept by no one and with no Referer', async () => {
    const { answer, locals } = await through(
      `https://blog.example/?hollware-preview=${TOKEN}&hollware-embed=1`,
      'hollware_preview=hw_prv_CC.DD',
    )

    expect(answer.status).toBe(200)
    expect(locals['hollwarePreview']).toBe(TOKEN)
    expect(answer.headers.get('set-cookie')).toBeNull()
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(answer.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('still exchanges a link without hollware-embed for a cookie and a 303', async () => {
    const { answer } = await through(`https://blog.example/?hollware-preview=${TOKEN}`)

    expect(answer.status).toBe(303)
    expect(answer.headers.get('referrer-policy')).toBe('no-referrer')
  })
})
