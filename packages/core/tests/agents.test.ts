import { describe, expect, it } from 'vite-plus/test'

import { verifyAgentEvent } from '../src/agents.ts'
import { signWebhook } from '../src/webhooks.ts'

const SECRET = 'whsec_agent'
const NOW = 1_792_000_000

const DELIVERY = {
  agent: 'reviewer',
  event: {
    id: 'evt_01J9ZQ3X5V7K2M4N6P8R0T1W3Y',
    kind: 'site.changed',
    site: 'blog',
    at: '2026-10-13T10:00:00.000Z',
    cacheTags: [],
  },
  grant: {
    token: 'hw_agt_0123456789abcdefghjkmnpqrstvwxyz0123456789abcdefgh',
    expiresAt: '2026-10-13T11:00:00.000Z',
    scopes: ['content:read', 'review:read', 'review:comment'],
    review: null,
    mcp: 'https://cms.example.com/mcp',
    ops: 'https://cms.example.com/v1/ops',
  },
}

async function request(body: string, options: { secret?: string; at?: number } = {}) {
  const at = options.at ?? NOW
  return new Request('https://agents.example.com/in', {
    method: 'POST',
    headers: {
      'hollware-timestamp': String(at),
      'hollware-signature': await signWebhook(options.secret ?? SECRET, at, body),
    },
    body,
  })
}

describe('verifyAgentEvent', () => {
  it('answers the delivery of a request signed with the secret', async () => {
    const answer = await verifyAgentEvent(await request(JSON.stringify(DELIVERY)), SECRET, {
      now: NOW,
    })

    expect(answer).toEqual(DELIVERY)
  })

  it('refuses a request signed with another secret, a body changed after signing, and one too old', async () => {
    const body = JSON.stringify(DELIVERY)
    const forged = await request(body, { secret: 'whsec_other' })
    const signed = await request(body)
    const tampered = new Request(signed.url, {
      method: 'POST',
      headers: signed.headers,
      body: body.replace('"review":null', '"review":"rvw_01J9ZQ3X5V7K2M4N6P8R0T1W3Y"'),
    })
    const old = await request(body, { at: NOW - 301 })

    expect([
      await verifyAgentEvent(forged, SECRET, { now: NOW }),
      await verifyAgentEvent(tampered, SECRET, { now: NOW }),
      await verifyAgentEvent(old, SECRET, { now: NOW }),
    ]).toEqual([null, null, null])
  })

  it('answers null for a signed body that is no delivery to an agent', async () => {
    const answer = await verifyAgentEvent(await request(JSON.stringify(DELIVERY.event)), SECRET, {
      now: NOW,
    })

    expect(answer).toBeNull()
  })
})
