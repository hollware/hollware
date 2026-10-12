import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import type { McpServerFactory } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import { buildServer } from '../../src/mcp/server.ts'
import { TOOLS_LIST_LEGACY, TOOLS_LIST_MODERN } from './golden.ts'
import { legacyRpc, modernRpc } from './helpers.ts'
import type { RpcResult } from './helpers.ts'

// S2d. Fails when: tools/list stops being byte-identical between calls and between fresh server
// instances, the SDK starts listing in an order other than registration order (the plan's "sorted"
// then needs code), the ttlMs / cacheScope hint stops appearing on 2026-07-28 results, or starts
// leaking into 2025-11-25 results.

const tools = (answer: RpcResult) => {
  const result = answer.message.result
  if (typeof result !== 'object' || result === null || !('tools' in result)) {
    throw new Error(`no tools in ${answer.text}`)
  }
  return result
}

const toolNames = (answer: RpcResult): string[] => {
  const { tools: listed } = tools(answer)
  if (!Array.isArray(listed)) throw new Error(`tools is not a list in ${answer.text}`)
  return listed.map((tool: unknown) =>
    typeof tool === 'object' && tool !== null && 'name' in tool ? String(tool.name) : '',
  )
}

describe('tools/list is deterministic', () => {
  it('is byte-identical across two calls to the Worker (2026-07-28)', async () => {
    const first = await modernRpc('tools/list', {}, 1)
    const second = await modernRpc('tools/list', {}, 1)

    expect(first.status).toBe(200)
    expect(second.text).toBe(first.text)
    expect(first.text).toBe(TOOLS_LIST_MODERN)
  })

  it('is byte-identical across two calls to the Worker (2025-11-25)', async () => {
    const first = await legacyRpc('tools/list', {}, 1)
    const second = await legacyRpc('tools/list', {}, 1)

    expect(second.text).toBe(first.text)
    expect(first.text).toBe(TOOLS_LIST_LEGACY)
  })

  it('is byte-identical across fresh server instances, built once per request', async () => {
    let built = 0
    const counting: McpServerFactory = (context) => {
      built += 1
      return buildServer(context)
    }
    const handler = createMcpHandler(counting)
    const ask = async () => {
      const response = await modernRpc('tools/list', {}, 1, (request) => handler.fetch(request))
      return response.text
    }

    const first = await ask()
    const second = await ask()
    const third = await ask()

    expect(built).toBe(3)
    expect(second).toBe(first)
    expect(third).toBe(first)
    // and identical to what the deployed route answers
    expect(first).toBe((await modernRpc('tools/list', {}, 1)).text)
  })

  it('builds a fresh server for every 2025-11-25 request too', async () => {
    let built = 0
    const handler = createMcpHandler((context) => {
      built += 1
      return buildServer(context)
    })
    const ask = async () => {
      const response = await legacyRpc('tools/list', {}, 1, (request) => handler.fetch(request))
      return response.text
    }

    const first = await ask()
    const second = await ask()

    expect(built).toBe(2)
    expect(second).toBe(first)
  })

  it('lists tools in registration order: the SDK does not sort', async () => {
    const reversed: McpServerFactory = () => {
      const server = new McpServer({ name: 'order', version: '0.0.0' })
      server.registerTool('zeta', {}, () => ({ content: [] }))
      server.registerTool('alpha', {}, () => ({ content: [] }))
      server.registerTool('mid', {}, () => ({ content: [] }))
      return server
    }
    const handler = createMcpHandler(reversed)

    const answer = await modernRpc('tools/list', {}, 1, (request) => handler.fetch(request))

    expect(toolNames(answer)).toEqual(['zeta', 'alpha', 'mid'])
    // The Worker registers alphabetically, so its list is sorted by construction.
    expect(toolNames(await modernRpc('tools/list'))).toEqual([
      'always_fails',
      'create_note',
      'echo',
    ])
  })
})

describe('the tools/list cache hint (ttlMs)', () => {
  it('McpServerOptions.cacheHints puts ttlMs and cacheScope on 2026-07-28 results', async () => {
    const answer = await modernRpc('tools/list')

    expect(tools(answer)).toMatchObject({
      resultType: 'complete',
      ttlMs: 60000,
      cacheScope: 'public',
    })
  })

  it('leaves them off 2025-11-25 results', async () => {
    const answer = await legacyRpc('tools/list')

    expect(Object.keys(tools(answer))).toEqual(['tools'])
  })

  it('defaults to ttlMs 0 and cacheScope private when no hint is configured', async () => {
    const bare = createMcpHandler(() => {
      const server = new McpServer({ name: 'bare', version: '0.0.0' })
      server.registerTool('only', {}, () => ({ content: [] }))
      return server
    })

    const answer = await modernRpc('tools/list', {}, 1, (request) => bare.fetch(request))

    expect(tools(answer)).toMatchObject({ ttlMs: 0, cacheScope: 'private' })
  })

  it('rejects an invalid hint when the server is constructed', () => {
    expect(
      () =>
        new McpServer(
          { name: 'bad', version: '0.0.0' },
          { cacheHints: { 'tools/list': { ttlMs: -1 } } },
        ),
    ).toThrow(RangeError)
  })
})
