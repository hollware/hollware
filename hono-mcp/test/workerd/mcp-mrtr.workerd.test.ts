import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import { buildMrtrServer } from '../../src/mcp/server-mrtr.ts'
import { MCP_URL, modernRpc } from './helpers.ts'

// ADR-012 plans confirmations as multi round-trip requests (MRTR) and keeps 2025 clients on a
// stateless fallback. Fails when: MRTR stops working for 2026-07-28 clients on the per-request
// server, or the 2025-11-25 fallback starts (or stops) being unable to ask the human, which is
// what the plan's `acknowledgeWarnings` argument exists for.

const handler = createMcpHandler(buildMrtrServer)

type Setup = { modern: boolean; elicitation: boolean; accept?: boolean }

async function connect(setup: Setup) {
  const asked: string[] = []
  const wire: { status: number; text: string }[] = []
  const client = new Client(
    { name: 'mrtr-client', version: '0.0.0' },
    {
      capabilities: setup.elicitation ? { elicitation: { form: {} } } : {},
      ...(setup.modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {}),
    },
  )
  if (setup.elicitation) {
    client.setRequestHandler('elicitation/create', (request) => {
      asked.push(request.params.message)
      return { action: setup.accept === false ? 'decline' : 'accept', content: { confirm: true } }
    })
  }
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      fetch: async (input, init) => {
        const response = await handler.fetch(new Request(input, init))
        wire.push({ status: response.status, text: await response.clone().text() })
        return response
      },
    }),
  )
  return { client, asked, wire }
}

describe('a confirmation asked as MRTR', () => {
  it('works for a 2026-07-28 client: ask, fulfil, retry, act', async () => {
    const { client, asked, wire } = await connect({ modern: true, elicitation: true })

    const result = await client.callTool({ name: 'confirm_delete', arguments: { id: 'note-1' } })

    expect(result.content).toEqual([{ type: 'text', text: 'deleted note-1' }])
    expect(asked).toEqual(['Delete note-1?'])
    // discover, the call that answers input_required, the retry that carries inputResponses
    expect(wire.map((entry) => entry.status)).toEqual([200, 200, 200])
    expect(JSON.parse(wire[1]?.text ?? 'null').result).toEqual({
      resultType: 'input_required',
      inputRequests: {
        confirm: {
          method: 'elicitation/create',
          params: {
            mode: 'form',
            message: 'Delete note-1?',
            requestedSchema: {
              $schema: 'https://json-schema.org/draft/2020-12/schema',
              type: 'object',
              properties: { confirm: { type: 'boolean' } },
              required: ['confirm'],
            },
          },
        },
      },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'spike-mrtr', version: '0.0.0' } },
    })
    await client.close()
  })

  it('ends on a decline when the handler checks for one', async () => {
    const { client, asked } = await connect({ modern: true, elicitation: true, accept: false })

    const result = await client.callTool({ name: 'confirm_delete', arguments: { id: 'note-1' } })

    expect(result.content).toEqual([{ type: 'text', text: 'kept note-1' }])
    expect(asked).toEqual(['Delete note-1?'])
    await client.close()
  })

  it('loops until maxRounds when the handler never checks for a decline', async () => {
    const { client, asked } = await connect({ modern: true, elicitation: true, accept: false })

    await expect(
      client.callTool({ name: 'naive_delete', arguments: { id: 'note-1' } }),
    ).rejects.toThrow(
      "Multi-round-trip request 'tools/call' still required input after 10 rounds (inputRequired.maxRounds)",
    )
    expect(asked).toHaveLength(10)
    await client.close()
  })

  it('answers HTTP 400 when a 2026-07-28 client declares no elicitation capability', async () => {
    const answer = await modernRpc(
      'tools/call',
      { name: 'confirm_delete', arguments: { id: 'note-1' } },
      1,
      (request) => handler.fetch(request),
    )

    expect(answer.status).toBe(400)
    expect(answer.message.error).toMatchObject({ code: -32021 })
  })

  it('cannot ask a 2025-11-25 client at all, even one that declares elicitation', async () => {
    const { client, asked } = await connect({ modern: false, elicitation: true })

    const result = await client.callTool({ name: 'confirm_delete', arguments: { id: 'note-1' } })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      {
        type: 'text',
        text: "Cannot request input 'confirm' (elicitation/create): the client on this 2025-era connection did not declare the required capability (no client capabilities are available on this connection — per-request legacy serving cannot receive server-to-client requests)",
      },
    ])
    expect(asked).toEqual([])
    await client.close()
  })
})
