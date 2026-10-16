import { describe, expect, it } from 'vite-plus/test'

import { ALLOWED_TOOLS, allowOnly, mcpHollware } from '../src/hollware.ts'

// Fails when: the agents' way into Hollware (src/hollware.ts) lets a tool through that publishes
// or decides (publish, approve_review, request_changes, unpublish), drops one they need, stops
// sending the call as MCP JSON-RPC to the public URL's /mcp with the token and the agents' client
// name and Host of the public URL (a service binding sends none), or stops reading the tool's
// output from JSON or from a server-sent event.

describe('the allowlist', () => {
  it('lets the reading and writing tools through, and refuses those that publish or decide', async () => {
    const called: string[] = []
    const hollware = allowOnly(async (tool) => {
      called.push(tool)
      return { outcome: 'ok' }
    })

    const refused = await Promise.all(
      ['publish', 'approve_review', 'request_changes', 'unpublish'].map((tool) =>
        // A tool name from outside the type, as a bug would produce it.
        hollware.call(JSON.parse(`"${tool}"`), {}).then(
          () => 'called',
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        ),
      ),
    )

    expect(refused).toEqual([
      'The agents never call publish',
      'The agents never call approve_review',
      'The agents never call request_changes',
      'The agents never call unpublish',
    ])
    expect(called).toEqual([])
    expect([...ALLOWED_TOOLS]).toEqual([
      'comment_review',
      'content_stats',
      'create_draft',
      'describe_site',
      'get_entry',
      'get_translations',
      'list_entries',
      'list_reviews',
      'request_review',
      'search',
      'update_draft',
      'validate',
    ])
  })
})

describe('mcpHollware', () => {
  it('calls the tool over MCP with the token, and reads its output from JSON or an event', async () => {
    const sent: { url: string; host: string | null; auth: string | null; body: unknown }[] = []
    const answers = [
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { structuredContent: { outcome: 'ok', n: 1 } },
      }),
      `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: { outcome: 'ok', n: 2 } } })}\n\n`,
    ]
    const hollware = mcpHollware({
      url: 'https://cms.example.com/',
      token: 'hw_pat_secret',
      fetch: async (request) => {
        sent.push({
          url: request.url,
          host: request.headers.get('host'),
          auth: request.headers.get('authorization'),
          body: await request.json(),
        })
        return new Response(answers.shift() ?? '')
      },
    })

    const first = await hollware.call('describe_site', {})
    const second = await hollware.call('get_entry', { collection: 'blog', locale: 'en', slug: 'a' })

    expect([first, second]).toEqual([
      { outcome: 'ok', n: 1 },
      { outcome: 'ok', n: 2 },
    ])
    expect(sent[1]).toMatchObject({
      url: 'https://cms.example.com/mcp',
      // A service binding sends no Host of its own: Hollware's guard needs it.
      host: 'cms.example.com',
      auth: 'Bearer hw_pat_secret',
      body: {
        method: 'tools/call',
        params: {
          name: 'get_entry',
          arguments: { collection: 'blog', locale: 'en', slug: 'a' },
          _meta: { 'io.modelcontextprotocol/clientInfo': { name: 'hollware-agents' } },
        },
      },
    })
  })

  it('takes an answer with no output for an error', async () => {
    const hollware = mcpHollware({
      url: 'https://cms.example.com',
      token: 't',
      fetch: async () => new Response('{"error":"no"}', { status: 401 }),
    })

    await expect(hollware.call('describe_site', {})).rejects.toThrow(
      'Hollware answered describe_site with 401',
    )
  })
})
