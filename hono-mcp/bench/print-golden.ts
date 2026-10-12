// One-off: captures the exact tools/list answers of the Zod server in both eras into
// test/workerd/golden.ts. Reviewed by eye once; the tests then hold the literals, they do not
// recompute them. Run again only on purpose (an SDK or schema change), and read the diff.
import { createMcpHandler } from '@modelcontextprotocol/server'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildServer } from '../src/mcp/server.ts'

const handler = createMcpHandler(buildServer)
const modern = await handler.fetch(
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
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'raw-client', version: '0.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  }),
)
const legacy = await handler.fetch(
  new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  }),
)
const modernText = await modern.text()
const legacyText = await legacy.text()
const out = `// Captured by bench/print-golden.ts and reviewed by eye. tools/list must stay byte-identical to these.
export const TOOLS_LIST_MODERN = ${JSON.stringify(modernText)}

export const TOOLS_LIST_LEGACY = ${JSON.stringify(legacyText)}
`
writeFileSync(resolve(import.meta.dirname, '../test/workerd/golden.ts'), out)
console.log(
  `wrote test/workerd/golden.ts (${modernText.length} and ${legacyText.length} characters)`,
)
