import type { AgentGrant, HollwareEvent } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { createHollwareAgents, type AgentsEnv } from '../src/worker.ts'

interface Call {
  readonly url: string
  readonly auth: string | null
  readonly tool: string
  readonly input: unknown
}

function item(id: string, proposed: string | null) {
  return {
    entry: { id, collection: 'blog', locale: 'es', slug: id },
    action: proposed === null ? 'unpublish' : 'publish',
    excluded: false,
    published: null,
    proposed,
    diff: '',
  }
}

function fakeHollware(items: readonly object[], getReview: 'ok' | 'broken' = 'ok') {
  const calls: Call[] = []
  return {
    calls,
    async fetch(request: Request) {
      const body: unknown = await request.json()
      const params: unknown =
        typeof body === 'object' && body !== null && 'params' in body ? body.params : null
      const tool =
        typeof params === 'object' && params !== null && 'name' in params ? String(params.name) : ''
      const input =
        typeof params === 'object' && params !== null && 'arguments' in params
          ? params.arguments
          : null
      calls.push({ url: request.url, auth: request.headers.get('authorization'), tool, input })
      if (tool === 'get_review' && getReview === 'broken') {
        return new Response('upstream failed', { status: 500 })
      }
      const outputs: Record<string, object> = {
        describe_site: { outcome: 'ok', site: { styleGuide: 'Short.', collections: [] } },
        get_review: { outcome: 'ok', review: { id: 'rvw_GRANT', comments: [] }, items },
        comment_review: { outcome: 'commented' },
      }
      return Response.json({
        jsonrpc: '2.0',
        id: 1,
        result: { structuredContent: outputs[tool] ?? {} },
      })
    },
  }
}

function fakeKv() {
  const values = new Map<string, string>()
  return {
    values,
    get: async (key: string) => values.get(key) ?? null,
    put: async (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

const requested: HollwareEvent = {
  id: 'evt_1',
  site: 'blog',
  at: '2026-10-29T10:00:00.000Z',
  cacheTags: [],
  kind: 'review.requested',
  review: { id: 'rvw_EVENT', status: 'pending', requestedBy: 'Ana', note: null },
  entry: { id: 'ent_A', collection: 'blog', locale: 'es', slug: 'a', translationGroup: null },
  adminPath: '/admin/reviews/rvw_EVENT',
}

const grant: AgentGrant = {
  token: 'hw_agt_grant',
  expiresAt: '2026-10-29T11:00:00.000Z',
  scopes: ['content:read', 'review:read', 'review:comment'],
  review: 'rvw_GRANT',
  mcp: 'https://cms.example.com/mcp',
  ops: 'https://cms.example.com/v1/ops',
}

function setup(items: readonly object[], options: { getReview?: 'ok' | 'broken' } = {}) {
  const hollware = fakeHollware(items, options.getReview)
  const kv = fakeKv()
  const env: AgentsEnv = {
    HOLLWARE: hollware,
    HOLLWARE_PUBLIC_URL: 'https://cms.example.com',
    HOLLWARE_AGENT_TOKEN: 'hw_pat_cron',
    AGENTS_KV: kv,
  }
  return { hollware, kv, env }
}

describe('handle', () => {
  it('comments on each entry of the review of the grant, as the grant', async () => {
    const { hollware, kv, env } = setup([
      item('ent_A', '# A\n'),
      item('ent_B', '# B\n'),
      item('ent_C', null),
    ])
    const read: string[] = []
    const agents = createHollwareAgents({
      model: async (messages) => {
        read.push(messages[1]?.content ?? '')
        return 'Clear.'
      },
    })

    await agents.handle(requested, grant, env)

    expect(hollware.calls.map(({ tool, input }) => ({ tool, input }))).toEqual([
      { tool: 'describe_site', input: {} },
      { tool: 'get_review', input: { id: 'rvw_GRANT' } },
      { tool: 'comment_review', input: { id: 'rvw_GRANT', body: 'Clear.', entryId: 'ent_A' } },
      { tool: 'comment_review', input: { id: 'rvw_GRANT', body: 'Clear.', entryId: 'ent_B' } },
    ])
    expect(new Set(hollware.calls.map((call) => `${call.url} ${call.auth}`))).toEqual(
      new Set(['https://cms.example.com/mcp Bearer hw_agt_grant']),
    )
    expect(read).toEqual([
      'Style guide:\nShort.\n\nEntry (es):\n\n# A\n',
      'Style guide:\nShort.\n\nEntry (es):\n\n# B\n',
    ])
    expect(kv.values.get('reviewed:rvw_GRANT')).toBe('commented')
  })

  it('comments on the whole review when it changes one entry, and once only', async () => {
    const { hollware, env } = setup([item('ent_A', '# A\n')])
    const agents = createHollwareAgents({ model: async () => 'Clear.' })

    await agents.handle(requested, grant, env)
    await agents.handle(requested, grant, env)

    expect(hollware.calls.map(({ tool, input }) => ({ tool, input }))).toEqual([
      { tool: 'describe_site', input: {} },
      { tool: 'get_review', input: { id: 'rvw_GRANT' } },
      { tool: 'comment_review', input: { id: 'rvw_GRANT', body: 'Clear.' } },
    ])
  })

  it('reads the review of the event when the grant names none', async () => {
    const { hollware, env } = setup([])
    const agents = createHollwareAgents({ model: async () => 'Clear.' })

    await agents.handle(requested, { ...grant, review: null }, env)

    expect(hollware.calls.map(({ tool, input }) => ({ tool, input }))).toEqual([
      { tool: 'describe_site', input: {} },
      { tool: 'get_review', input: { id: 'rvw_EVENT' } },
    ])
  })

  it('ignores every other kind of event', async () => {
    const { hollware, env } = setup([item('ent_A', '# A\n')])
    const agents = createHollwareAgents({ model: async () => 'Clear.' })

    await agents.handle({ ...requested, kind: 'review.decided' }, { ...grant, review: null }, env)
    await agents.handle(
      {
        id: 'evt_2',
        site: 'blog',
        at: '2026-10-29T10:00:00.000Z',
        cacheTags: [],
        kind: 'site.changed',
      },
      { ...grant, review: null },
      env,
    )

    expect(hollware.calls).toEqual([])
  })

  it('throws a failure, so Hollware delivers the event again, and remembers nothing', async () => {
    const { kv, env } = setup([], { getReview: 'broken' })
    const agents = createHollwareAgents({ model: async () => 'Clear.' })

    await expect(agents.handle(requested, grant, env)).rejects.toThrow(
      'Hollware answered get_review with 500: upstream failed',
    )
    expect(kv.values.get('reviewed:rvw_GRANT')).toBe(undefined)
  })

  it('ends quietly at the limit of model calls of the day', async () => {
    const { hollware, env } = setup([item('ent_A', '# A\n')])
    const agents = createHollwareAgents({ model: async () => 'Clear.', dailyLimit: 0 })

    await agents.handle(requested, grant, env)

    expect(hollware.calls.map((call) => call.tool)).toEqual(['describe_site', 'get_review'])
  })
})

describe('the cron without a personal token', () => {
  it('skips its roles, and calls nothing', async () => {
    const { hollware, env } = setup([])
    const agents = createHollwareAgents({
      model: async () => 'Clear.',
      clock: () => new Date('2026-10-15T10:00:00Z'),
    })

    await agents.run({ ...env, HOLLWARE_AGENT_TOKEN: '' })

    expect(hollware.calls).toEqual([])
  })
})
