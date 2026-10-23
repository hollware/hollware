import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vite-plus/test'

vi.mock('nitropack/runtime', () => ({ defineNitroPlugin: (plugin: unknown) => plugin }))

const { default: plugin } = await import('../src/runtime/server/preview.ts')

type Hook = (event: H3Event) => void

function hooked(): Map<string, Hook> {
  const hooks = new Map<string, Hook>()
  Reflect.apply(plugin, undefined, [
    { hooks: { hook: (name: string, hook: Hook) => hooks.set(name, hook) } },
  ])
  return hooks
}

function eventWith(cookie: string | undefined): H3Event {
  const request = new IncomingMessage(new Socket())
  if (cookie !== undefined) request.headers.cookie = cookie
  const event = createEvent(request, new ServerResponse(request))
  event.node.res.setHeader('cache-control', 'public, max-age=60')
  event.node.res.setHeader('cache-tag', 'hw:site')
  event.node.res.setHeader('cloudflare-cdn-cache-control', 'max-age=31536000')
  return event
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
})
