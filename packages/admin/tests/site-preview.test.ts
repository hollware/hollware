import { expect, it } from 'vite-plus/test'

import { createApi } from '../app/lib/api.ts'
import type { Auth } from '../app/lib/auth.ts'
import {
  embedOf,
  isReadyMessage,
  liveEntryMessage,
  openPreview,
  refreshOf,
} from '../app/lib/site-preview.ts'

function world(answer: unknown, status = 200) {
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
      return Response.json(answer, { status })
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

const LINK = {
  token: 'hw_prv_a.b',
  expiresAt: '2026-10-17T13:00:00.000Z',
  url: 'https://site.example/blog/hello/?hollware-preview=hw_prv_a.b',
  embedUrl: 'https://site.example/_hollware/preview/hw_prv_a.b',
}

it('reloads the same page after a save while the link has five minutes or more left', () => {
  expect(refreshOf(LINK, Date.parse('2026-10-17T12:55:00.000Z'))).toBe('reload')
  expect(refreshOf(LINK, Date.parse('2026-10-17T12:55:00.001Z'))).toBe('renew')
  expect(refreshOf(null, Date.parse('2026-10-17T12:00:00.000Z'))).toBe('renew')
  expect(refreshOf({ ...LINK, expiresAt: 'soon' }, 0)).toBe('renew')
})

it('frames the page of the site in a sandbox that keeps the origin of the site, never of the admin', () => {
  expect(embedOf(LINK, 'https://cms.example')).toEqual({
    src: 'https://site.example/_hollware/preview/hw_prv_a.b',
    sandbox: 'allow-scripts allow-forms allow-popups allow-same-origin',
  })
  expect(embedOf(LINK, 'https://site.example')).toEqual({
    src: 'https://site.example/_hollware/preview/hw_prv_a.b',
    sandbox: 'allow-scripts allow-forms allow-popups',
  })
})

it('frames nothing without a page to show, or with a url that is no web page', () => {
  expect(embedOf({ ...LINK, embedUrl: null }, 'https://cms.example')).toBeNull()
  expect(
    embedOf({ token: 't', expiresAt: LINK.expiresAt, url: null }, 'https://cms.example'),
  ).toBeNull()
  expect(embedOf(null, 'https://cms.example')).toBeNull()
  expect(embedOf({ ...LINK, embedUrl: 'javascript:alert(1)' }, 'https://cms.example')).toBeNull()
  expect(embedOf({ ...LINK, embedUrl: '/relative' }, 'https://cms.example')).toBeNull()
})

it('asks the server what the unsaved Markdown makes and wraps it as the message a page in the pane takes', async () => {
  const entry = { id: 'ent_01', frontmatter: { title: 'Live' }, document: { nodes: [] } }
  const { api, sent } = world({ outcome: 'ok', entry })

  const message = await liveEntryMessage(api, 'ent_01', '---\ntitle: Live\n---\n')

  expect(message).toEqual({ type: 'hollware:preview-entry', entry })
  expect(sent).toEqual([
    {
      url: '/v1/admin/preview/document',
      method: 'POST',
      body: JSON.stringify({ entryId: 'ent_01', markdown: '---\ntitle: Live\n---\n' }),
    },
  ])
})

it('sends nothing while the Markdown makes no page', async () => {
  const { api } = world({ code: 'invalid_input', message: 'no', fix: 'keep writing' }, 400)

  expect(await liveEntryMessage(api, 'ent_01', '---\ntitle: [\n')).toBeNull()
})

it('knows the page in the pane is ready by its message, and nothing else', () => {
  expect(isReadyMessage({ type: 'hollware:preview-ready' })).toBe(true)
  expect(isReadyMessage({ type: 'hollware:preview-entry' })).toBe(false)
  expect(isReadyMessage('hollware:preview-ready')).toBe(false)
  expect(isReadyMessage(null)).toBe(false)
})
