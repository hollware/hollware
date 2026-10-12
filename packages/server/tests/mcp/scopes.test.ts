import { createDraft } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { scopeChallenge } from '../../src/mcp/scopes.ts'
import { createToolTable } from '../../src/mcp/tools.ts'
import {
  ALL_SCOPES,
  callRaw,
  connect,
  endpointWith,
  INPUTS,
  makeCall,
  tokenPrincipal,
} from './support.ts'

// Fails when: a tool stops requiring the scopes of its spec at call time, or requires others; a
// refusal stops being 403 with the challenge that names the scope; the handler runs for a call
// that was refused; the challenge names only the missing scopes instead of every scope the tool
// needs; a call without scopes passes; or a request that comes without a principal reaches the
// SDK or a handler.

const REQUIRED = [
  ['create_draft', 'content:write'],
  ['describe_site', 'content:read'],
  ['get_entry', 'content:read'],
  ['get_translations', 'content:read'],
  ['list_entries', 'content:read'],
  ['publish', 'content:publish'],
  ['unpublish', 'content:publish'],
  ['update_draft', 'content:write'],
  ['validate', 'content:read'],
] as const

const ERAS = ['modern', 'legacy'] as const

describe('the scopes of a tool', () => {
  for (const era of ERAS) {
    it.each(REQUIRED)(
      `refuse %s to a principal without %s with 403 and the challenge (${era})`,
      async (tool, scope) => {
        const { endpoint, seen } = endpointWith()
        const principal = tokenPrincipal(ALL_SCOPES.filter((granted) => granted !== scope))

        const answer = await callRaw(endpoint, era, tool, INPUTS[tool], {
          call: makeCall({ principal }),
        })

        expect(answer.status).toBe(403)
        expect(answer.headers.get('www-authenticate')).toBe(
          `Bearer error="insufficient_scope", error_description="${tool} requires: ${scope}", scope="${scope}"`,
        )
        expect(answer.message).toEqual({
          error: 'insufficient_scope',
          error_description: `${tool} requires: ${scope}`,
        })
        expect(seen).toEqual([])
      },
    )

    it.each(REQUIRED)(
      `serve %s to a principal with %s and nothing else (${era})`,
      async (tool, scope) => {
        const { endpoint, seen } = endpointWith()
        const principal = tokenPrincipal([scope])

        const answer = await callRaw(endpoint, era, tool, INPUTS[tool], {
          call: makeCall({ principal }),
        })

        expect(answer.status).toBe(200)
        expect(answer.result.isError).toBe(false)
        expect(seen.map((call) => call.tool)).toEqual([tool])
      },
    )
  }

  it.each(ERAS)(
    'refuse create_draft to a content:read principal with 403 naming content:write, and no handler runs (%s)',
    async (era) => {
      const { endpoint, seen, logs } = endpointWith()
      const principal = tokenPrincipal(['content:read'])

      const answer = await callRaw(endpoint, era, 'create_draft', INPUTS.create_draft, {
        call: makeCall({ principal, requestId: 'req_read_only' }),
      })

      expect(answer.status).toBe(403)
      expect(answer.headers.get('www-authenticate')).toBe(
        'Bearer error="insufficient_scope", error_description="create_draft requires: content:write", scope="content:write"',
      )
      expect(seen).toEqual([])
      expect(logs).toHaveLength(1)
    },
  )

  it('refuse a principal without any scope', async () => {
    const { endpoint, seen } = endpointWith()

    const answer = await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries, {
      call: makeCall({ principal: tokenPrincipal([]) }),
    })

    expect(answer.status).toBe(403)
    expect(seen).toEqual([])
  })

  it('reach an SDK client as the step-up error that names the scope, and the call goes no further', async () => {
    const { endpoint, seen } = endpointWith()
    const { client } = await connect(endpoint, {
      era: '2026',
      principal: tokenPrincipal(['content:read']),
    })

    await expect(
      client.callTool({ name: 'create_draft', arguments: INPUTS.create_draft }),
    ).rejects.toThrow('Insufficient scope: required "content:write"')
    expect(seen).toEqual([])
    await client.close()
  })

  it('are checked for a Worker of the same account like for a token', async () => {
    const { endpoint, seen } = endpointWith()
    const principal = { kind: 'binding', scopes: ['content:read'] } as const

    const read = await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries, {
      call: makeCall({ principal }),
    })
    const write = await callRaw(endpoint, 'modern', 'create_draft', INPUTS.create_draft, {
      call: makeCall({ principal }),
    })

    expect([read.status, write.status]).toEqual([200, 403])
    expect(seen.map((call) => call.tool)).toEqual(['list_entries'])
  })
})

describe('the scope challenge', () => {
  const [tool] = createToolTable([createDraft])
  if (tool === undefined) throw new Error('no tool')
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call' } as const
  const needsTwo = { ...tool, scopes: ['content:read', 'content:publish'] } as const

  it('names every scope the tool needs, not only the missing ones', async () => {
    let denied = 0
    const challenge = scopeChallenge(needsTwo, () => (denied += 1))

    const answer = await challenge({
      request,
      authInfo: { token: '', clientId: 'tok_1', scopes: ['content:read'] },
    })

    expect(answer).toEqual({
      scopes: ['content:read', 'content:publish'],
      errorDescription: 'create_draft requires: content:read content:publish',
    })
    expect(denied).toBe(1)
  })

  it('lets through a principal that has every scope, and says nothing', async () => {
    let denied = 0
    const challenge = scopeChallenge(needsTwo, () => (denied += 1))

    const answer = await challenge({
      request,
      authInfo: {
        token: '',
        clientId: 'tok_1',
        scopes: ['schema:admin', 'content:publish', 'content:read'],
      },
    })

    expect(answer).toBeUndefined()
    expect(denied).toBe(0)
  })

  it('refuses a request that comes without any authentication', async () => {
    let denied = 0
    const challenge = scopeChallenge(needsTwo, () => (denied += 1))

    const answer = await challenge({ request })

    expect(answer?.scopes).toEqual(['content:read', 'content:publish'])
    expect(denied).toBe(1)
  })
})

describe('a call without a principal', () => {
  const { requestId, context } = makeCall()

  it.each([
    ['a call without one', { requestId, context }],
    ['no call at all', undefined],
  ])('is never served: %s', async (_label, call) => {
    const { endpoint, seen, logs } = endpointWith()
    const request = new Request('http://hollware.test/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    })

    // @ts-expect-error -- the type asks for a call with a principal; a caller in JavaScript may not.
    const served = endpoint.fetch(request, call)

    await expect(served).rejects.toThrow(
      'The MCP endpoint serves a request only as the principal the gateway found',
    )
    expect(request.bodyUsed).toBe(false)
    expect(seen).toEqual([])
    expect(logs).toEqual([])
  })
})
