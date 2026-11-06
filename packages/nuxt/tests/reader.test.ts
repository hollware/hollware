import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    hollware: { site: 'blog', binding: 'HOLLWARE', url: '', token: '' },
  }),
}))

const { useHollware } = await import('../src/runtime/server/reader.ts')
const { tagsOf } = await import('../src/runtime/tags.ts')

class Binding {
  getEntry() {
    return Promise.resolve({ outcome: 'ok', entry: { id: 'ent_1' } })
  }
  search(site: string, query: string) {
    return Promise.resolve({ outcome: 'ok', results: [{ site, query }] })
  }
  listRedirects(site: string) {
    return Promise.resolve({ outcome: 'ok', redirects: [{ site }], nextCursor: null })
  }
  resolvePath(_site: string, path: string) {
    return Promise.resolve(
      path === '/nothing/'
        ? { outcome: 'not_found' }
        : { outcome: 'ok', collection: 'help', locale: 'es', slug: 'pagos', path },
    )
  }
}

function eventWith(binding: unknown): H3Event {
  const request = new IncomingMessage(new Socket())
  const event = createEvent(request, new ServerResponse(request))
  event.context['cloudflare'] = { env: { HOLLWARE: binding } }
  return event
}

describe('useHollware over a service binding', () => {
  it('answers every method of a binding whose methods live on its prototype, as an RPC stub', async () => {
    const event = eventWith(new Binding())
    const { site, reader } = useHollware(event)

    expect(
      await Promise.all([
        reader.search(site, 'workers'),
        reader.listRedirects(site),
        reader.getEntry(site, 'blog', 'hello', 'en'),
      ]),
    ).toEqual([
      { outcome: 'ok', results: [{ site: 'blog', query: 'workers' }] },
      { outcome: 'ok', redirects: [{ site: 'blog' }], nextCursor: null },
      { outcome: 'ok', entry: { id: 'ent_1' } },
    ])
    expect(tagsOf(event)).toEqual(['entry:ent_1'])
  })
})

describe('resolvePath over a service binding', () => {
  it('tags the page with the navigation of the collection it resolves in, and nothing for a path no entry has', async () => {
    const found = eventWith(new Binding())
    const missing = eventWith(new Binding())

    await useHollware(found).reader.resolvePath('blog', '/ayuda/facturacion/pagos/')
    await useHollware(missing).reader.resolvePath('blog', '/nothing/')

    expect(tagsOf(found)).toEqual(['list:help:es'])
    expect(tagsOf(missing)).toEqual([])
  })
})
