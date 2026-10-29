import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { EVENT_ID_HEADER, SIGNATURE_HEADER, signWebhook, TIMESTAMP_HEADER } from '@hollware/core'
import { createEvent, type H3Event } from 'h3'
import { describe, expect, it, vi } from 'vite-plus/test'

const SECRET = `whsec_${'4'.repeat(64)}`

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ hollware: { site: 'docs', webhookSecret: SECRET } }),
}))

const { default: webhook } = await import('../src/runtime/server/routes/webhook.ts')

async function signed(cache: Record<string, unknown>): Promise<H3Event> {
  const body = JSON.stringify({ id: 'evt_1', site: 'docs', cacheTags: ['entry:ent_1'] })
  const timestamp = Math.floor(Date.now() / 1000)
  const request = new IncomingMessage(new Socket())
  request.method = 'POST'
  request.headers = {
    'content-type': 'application/json',
    'content-length': String(body.length),
    [EVENT_ID_HEADER]: 'evt_1',
    [TIMESTAMP_HEADER]: String(timestamp),
    [SIGNATURE_HEADER]: await signWebhook(SECRET, timestamp, body),
  }
  request.push(body)
  request.push(null)
  const event = createEvent(request, new ServerResponse(request))
  event.context['cloudflare'] = { context: { cache } }
  return event
}

describe('the webhook of the cache', () => {
  it('marks the pages of a change stale and keeps them, so a failed render serves the old one', async () => {
    const invalidate = vi.fn(async () => ({ success: true, errors: [] }))
    const purge = vi.fn(async () => ({ success: true, errors: [] }))

    const answer: unknown = await webhook(await signed({ invalidate, purge }))

    expect(answer).toEqual({ invalidated: ['entry:ent_1'] })
    expect(invalidate).toHaveBeenCalledWith({ tags: ['entry:ent_1'] })
    expect(purge).not.toHaveBeenCalled()
  })
})
