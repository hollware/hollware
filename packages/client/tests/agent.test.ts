import { describe, expect, it } from 'vite-plus/test'

import { hollwareAgentBindingClient, hollwareAgentClient, type AgentGrant } from '../src/index.ts'

const GRANT: AgentGrant = {
  token: 'hw_agt_0123456789abcdefghjkmnpqrstvwxyz0123456789abcdefgh',
  expiresAt: '2026-10-29T13:00:00.000Z',
  scopes: ['content:read', 'review:read', 'review:comment'],
  review: 'rvw_01J9ZQ3X5V7K2M4N6P8R0T1W3Y',
  mcp: 'https://cms.example.com/mcp',
  ops: 'https://cms.example.com/v1/ops',
}

describe('hollwareAgentClient', () => {
  it('posts the operation to the ops endpoint of the grant, with the grant as its bearer', async () => {
    const sent: { url: string; auth: string | null; body: string }[] = []
    const client = hollwareAgentClient(GRANT, {
      fetch: async (request) => {
        sent.push({
          url: request.url,
          auth: request.headers.get('authorization'),
          body: await request.text(),
        })
        return Response.json({ outcome: 'commented' })
      },
    })

    const answer = await client.call('comment_review', { id: GRANT.review ?? '', body: 'Clear.' })

    expect(answer).toEqual({ outcome: 'commented' })
    expect(sent).toEqual([
      {
        url: 'https://cms.example.com/v1/ops/comment_review',
        auth: 'Bearer hw_agt_0123456789abcdefghjkmnpqrstvwxyz0123456789abcdefgh',
        body: '{"id":"rvw_01J9ZQ3X5V7K2M4N6P8R0T1W3Y","body":"Clear."}',
      },
    ])
  })

  it('throws what Hollware answered when it refuses', async () => {
    const client = hollwareAgentClient(GRANT, {
      fetch: async () =>
        Response.json(
          { code: 'insufficient_scope', message: 'Missing content:write.', fix: 'Ask for it.' },
          { status: 403 },
        ),
    })

    await expect(
      client.call('create_draft', {
        collection: 'blog',
        locale: 'en',
        slug: 'a',
        markdown: '# A',
      }),
    ).rejects.toThrow(
      'Hollware answered create_draft with 403 insufficient_scope: Missing content:write. Ask for it.',
    )
  })

  it('runs over a binding to HollwareOps with the grant as the token', async () => {
    const calls: unknown[][] = []
    const client = hollwareAgentBindingClient(
      {
        ops: async (...args: unknown[]) => {
          calls.push(args)
          return { outcome: 'ok' }
        },
      },
      GRANT,
    )

    await client.call('get_review', { id: 'rvw_01J9ZQ3X5V7K2M4N6P8R0T1W3Y' })

    expect(calls).toEqual([
      ['get_review', { id: 'rvw_01J9ZQ3X5V7K2M4N6P8R0T1W3Y' }, { token: GRANT.token }],
    ])
  })
})
