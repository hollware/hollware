import { describe, expect, it } from 'vite-plus/test'

import { previewResponse } from '../src/preview.ts'

describe('a page read with a preview token', () => {
  it('is no-store even when the response the page got has headers that cannot change', () => {
    const page = Response.redirect('https://blog.example/blog/', 302)

    const answer = previewResponse(page, false, new URL('https://blog.example/blog/hola/'))

    expect([answer.status, answer.headers.get('cache-control')]).toEqual([302, 'no-store'])
  })
})
