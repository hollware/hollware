import { createMcpHandler } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vite-plus/test'
import { PRECOMPUTED_SCHEMAS } from '../../src/mcp/schemas.generated.ts'
import { buildMemoizedServer } from '../../src/mcp/server-memoized.ts'
import { buildServer } from '../../src/mcp/server.ts'
import { buildPrecomputedServer } from '../../src/mcp/server-precomputed.ts'
import { TOOLS_LIST_LEGACY, TOOLS_LIST_MODERN } from '../workerd/golden.ts'

// Fails when: src/mcp/schemas.generated.ts drifts from what the Zod server advertises (rerun
// `node bench/generate-schemas.ts`), or one of the three server builders stops answering tools/list
// with the golden bytes in Node. The same golden strings are asserted inside workerd by
// test/workerd/*, so Node and workerd are held to the same bytes.

const ENVELOPE = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'raw-client', version: '0.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

type ListedTool = { name: string; inputSchema: unknown; outputSchema: unknown }

const modernList = () =>
  new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/list',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { _meta: ENVELOPE },
    }),
  })

const legacyList = () =>
  new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })

describe.each([
  ['Zod', buildServer],
  ['memoized Zod', buildMemoizedServer],
  ['precomputed', buildPrecomputedServer],
])('the %s server in Node', (_label, factory) => {
  const handler = createMcpHandler(factory)

  it('answers tools/list with the golden bytes (2026-07-28)', async () => {
    expect(await (await handler.fetch(modernList())).text()).toBe(TOOLS_LIST_MODERN)
  })

  it('answers tools/list with the golden bytes (2025-11-25)', async () => {
    expect(await (await handler.fetch(legacyList())).text()).toBe(TOOLS_LIST_LEGACY)
  })
})

describe('the generated schemas', () => {
  it('are exactly what the Zod server advertises, tool by tool', async () => {
    const handler = createMcpHandler(buildServer)
    const listed: { result: { tools: ListedTool[] } } = JSON.parse(
      await (await handler.fetch(modernList())).text(),
    )
    const advertised = Object.fromEntries(
      listed.result.tools.map((tool) => [
        tool.name,
        { input: tool.inputSchema, output: tool.outputSchema },
      ]),
    )

    expect(Object.keys(PRECOMPUTED_SCHEMAS)).toEqual(['always_fails', 'create_note', 'echo'])
    expect(JSON.stringify(PRECOMPUTED_SCHEMAS)).toBe(JSON.stringify(advertised))
  })
})
