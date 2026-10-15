import { describe, expect, it } from 'vite-plus/test'

import { sendView } from '../src/runtime/beacon.ts'

// Fails when: the beacon of @hollware/nuxt (src/runtime/beacon.ts) stops sending to the Hollware's
// /events only the site and the path, as text so that no preflight is needed, without cookies and
// so that it outlives the page; or lets a failed send reach the page.

describe('sendView', () => {
  it('sends the site and the path, and nothing of the reader', async () => {
    const sent: [string, RequestInit][] = []

    sendView(
      async (url, init) => {
        sent.push([url, init])
      },
      'https://cms.example.com/',
      'blog',
      '/blog/edge/',
    )

    expect(sent).toEqual([
      [
        'https://cms.example.com/events',
        {
          method: 'POST',
          body: '{"site":"blog","path":"/blog/edge/"}',
          headers: { 'content-type': 'text/plain;charset=UTF-8' },
          credentials: 'omit',
          keepalive: true,
          mode: 'no-cors',
        },
      ],
    ])
  })

  it('keeps a failed send from the page', async () => {
    let unhandled = 0
    const count = () => {
      unhandled += 1
    }
    process.on('unhandledRejection', count)

    sendView(() => Promise.reject(new Error('offline')), 'https://cms.example.com', 'blog', '/')
    await new Promise((resolve) => setTimeout(resolve, 10))

    process.off('unhandledRejection', count)
    expect(unhandled).toBe(0)
  })
})
