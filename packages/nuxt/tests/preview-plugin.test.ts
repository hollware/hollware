import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vite-plus/test'

const runtime = vi.hoisted(() => ({ url: '' }))

vi.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (plugin: unknown) => plugin,
  useRuntimeConfig: () => ({ hollware: { url: runtime.url } }),
}))

const { default: plugin } = await import('../src/runtime/server/preview.ts')

const TOKEN = 'hw_prv_eyJzIjoicyJ9.c2ln-_9'

type Hook = (event: H3Event) => void

function hooked(): Map<string, Hook> {
  const hooks = new Map<string, Hook>()
  Reflect.apply(plugin, undefined, [
    { hooks: { hook: (name: string, hook: Hook) => hooks.set(name, hook) } },
  ])
  return hooks
}

function eventWith(cookie: string | undefined, url = '/'): H3Event {
  const request = new IncomingMessage(new Socket())
  request.url = url
  request.headers.host = 'site.test'
  if (cookie !== undefined) request.headers.cookie = cookie
  const event = createEvent(request, new ServerResponse(request))
  event.node.res.setHeader('cache-control', 'public, max-age=60')
  event.node.res.setHeader('cache-tag', 'hw:site')
  event.node.res.setHeader('cloudflare-cdn-cache-control', 'max-age=31536000')
  return event
}

class HeadlessResponse extends ServerResponse {
  override end(..._chunk: unknown[]): this {
    return this
  }
}

describe('the preview plugin of Nitro', () => {
  it('marks a preview request for the cache to vary on, and leaves a visitor unmarked', () => {
    const hooks = hooked()
    const preview = eventWith('hollware_preview=hw_prv_eyJzIjoicyJ9.c2ln-_9')
    const visitor = eventWith(undefined)
    hooks.get('request')?.(preview)
    hooks.get('request')?.(visitor)
    expect(preview.node.req.headers['x-hollware-preview']).toMatch(/^[0-9a-f-]{36}$/)
    expect(visitor.node.req.headers['x-hollware-preview']).toBeUndefined()
  })

  it('answers a preview with no-store and without the headers that would cache it at the edge', () => {
    const hooks = hooked()
    const preview = eventWith('hollware_preview=hw_prv_eyJzIjoicyJ9.c2ln-_9')
    const visitor = eventWith(undefined)
    hooks.get('beforeResponse')?.(preview)
    hooks.get('beforeResponse')?.(visitor)
    expect(preview.node.res.getHeaders()).toEqual({ 'cache-control': 'no-store' })
    expect(visitor.node.res.getHeaders()).toEqual({
      'cache-control': 'public, max-age=60',
      'cache-tag': 'hw:site',
      'cloudflare-cdn-cache-control': 'max-age=31536000',
    })
  })

  it('renders an embedded preview in place: the token reaches this request only, and the answer is kept by no one and framed by Hollware alone', () => {
    runtime.url = 'https://cms.example.com/'
    const hooks = hooked()
    const embedded = eventWith('theme=dark', `/en/?hollware-preview=${TOKEN}&hollware-embed=1`)
    embedded.node.res.setHeader('x-frame-options', 'DENY')

    hooks.get('request')?.(embedded)
    embedded.node.res.setHeader('content-security-policy', "default-src 'self'")
    embedded.node.res.end('<html></html>')

    expect(embedded.node.req.headers.cookie).toBe(`hollware_preview=${TOKEN}; theme=dark`)
    expect(embedded.node.req.headers['x-hollware-preview']).toMatch(/^[0-9a-f-]{36}$/)
    expect(embedded.node.res.getHeaders()).toEqual({
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy': ["default-src 'self'", 'frame-ancestors https://cms.example.com'],
    })
  })

  it('lets Hollware frame the error page of an embedded preview, which Nitro answers with X-Frame-Options: DENY after every hook', () => {
    runtime.url = 'https://cms.example.com'
    const hooks = hooked()
    const embedded = eventWith(undefined, `/missing/?hollware-preview=${TOKEN}&hollware-embed=1`)

    hooks.get('request')?.(embedded)
    embedded.node.res.setHeader('x-frame-options', 'DENY')
    embedded.node.res.setHeader('cache-control', 'no-cache')
    embedded.node.res.writeHead(404)
    embedded.node.res.end('<h1>Page not found</h1>')

    expect(embedded.node.res.getHeaders()).toEqual({
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy': ['frame-ancestors https://cms.example.com'],
    })
  })

  it('settles the headers of an embedded preview when the answer ends, as on Workers, where nothing writes its head', () => {
    runtime.url = 'https://cms.example.com'
    const hooks = hooked()
    const request = new IncomingMessage(new Socket())
    request.url = `/missing/?hollware-preview=${TOKEN}&hollware-embed=1`
    request.headers.host = 'site.test'
    const response = new HeadlessResponse(request)
    const embedded = createEvent(request, response)

    hooks.get('request')?.(embedded)
    response.setHeader('x-frame-options', 'DENY')
    response.end('<h1>Page not found</h1>')

    expect(response.getHeaders()).toEqual({
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'content-security-policy': ['frame-ancestors https://cms.example.com'],
    })
  })

  it('leaves frame-ancestors to the site when it reads over a binding, with no Hollware URL', () => {
    runtime.url = ''
    const hooks = hooked()
    const embedded = eventWith(undefined, `/en/?hollware-preview=${TOKEN}&hollware-embed=1`)

    hooks.get('request')?.(embedded)
    embedded.node.res.end()

    expect(embedded.node.res.getHeader('content-security-policy')).toBeUndefined()
    expect(embedded.node.res.getHeader('referrer-policy')).toBe('no-referrer')
  })

  it('sends no Referrer-Policy and no frame-ancestors for a preview by its cookie', () => {
    runtime.url = 'https://cms.example.com'
    const hooks = hooked()
    const previewed = eventWith(`hollware_preview=${TOKEN}`, '/en/')

    hooks.get('request')?.(previewed)
    hooks.get('beforeResponse')?.(previewed)

    expect(previewed.node.res.getHeaders()).toEqual({ 'cache-control': 'no-store' })
  })
})
