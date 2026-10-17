import { expect, it } from 'vite-plus/test'

import { createApi } from '../app/lib/api.ts'
import type { Auth } from '../app/lib/auth.ts'
import { openPreview } from '../app/lib/site-preview.ts'

// Fails when: openPreview (app/lib/site-preview.ts) stops asking POST /v1/admin/preview, with the
// access token, for the entry it is given, opens a link the server did not answer (or one when the
// answer has no url), or stops saying whether it opened one (Entry.vue's "Preview on the site",
// T-103).

function world(answer: { token: string; expiresAt: string; url: string | null }) {
  const sent: Array<{ url: string; method: string; body: string }> = []
  const opened: string[] = []
  const auth: Auth = {
    signIn: async () => {},
    switchSite: async () => {},
    complete: async () => '/',
    token: async () => 'access-1',
    forget: () => {},
    signOut: async () => {},
  }
  const api = createApi({
    fetch: async (input, init) => {
      sent.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : '',
      })
      return Response.json(answer)
    },
    auth,
    here: () => '/admin/entries',
  })
  return { api, sent, opened, open: (url: string) => void opened.push(url) }
}

it('opens the url the server made for the entry, and says so', async () => {
  const { api, sent, opened, open } = world({
    token: 'hw_prv_a.b',
    expiresAt: '2026-10-17T13:00:00.000Z',
    url: 'https://site.example/blog/hello/?hollware-preview=hw_prv_a.b',
  })

  const result = await openPreview(api, 'ent_01', open)

  expect(result).toBe('opened')
  expect(sent).toEqual([{ url: '/v1/admin/preview', method: 'POST', body: '{"entryId":"ent_01"}' }])
  expect(opened).toEqual(['https://site.example/blog/hello/?hollware-preview=hw_prv_a.b'])
})

it('opens nothing when the site has no page for the entry', async () => {
  const { api, opened, open } = world({
    token: 'hw_prv_a.b',
    expiresAt: '2026-10-17T13:00:00.000Z',
    url: null,
  })

  expect(await openPreview(api, 'ent_01', open)).toBe('no_url')
  expect(opened).toEqual([])
})
