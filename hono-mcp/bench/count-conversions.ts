// How many Zod -> JSON Schema conversions one request makes: wraps the schemas of one tool with
// counters and runs tools/list, tools/call (modern) and tools/call (legacy) through createMcpHandler.
//   node --conditions=workerd bench/count-conversions.ts
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import * as z from 'zod'

const counts = { input: 0, output: 0 }
function counting<I, O>(schema: StandardSchemaWithJSON<I, O>): StandardSchemaWithJSON<I, O> {
  const standard = schema['~standard']
  return {
    '~standard': {
      version: standard.version,
      vendor: standard.vendor,
      types: standard.types,
      validate: (value, options) => standard.validate(value, options),
      jsonSchema: {
        input: (options) => {
          counts.input += 1
          return standard.jsonSchema.input(options)
        },
        output: (options) => {
          counts.output += 1
          return standard.jsonSchema.output(options)
        },
      },
    },
  }
}

const input = counting(z.object({ message: z.string() }))
const output = counting(z.object({ echoed: z.string() }))
const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'count', version: '0' })
  server.registerTool('echo', { inputSchema: input, outputSchema: output }, ({ message }) => ({
    content: [{ type: 'text', text: message }],
    structuredContent: { echoed: message },
  }))
  return server
})
const ENVELOPE = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'c', version: '0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}
async function send(
  label: string,
  era: 'modern' | 'legacy',
  method: string,
  params: Record<string, unknown>,
) {
  counts.input = 0
  counts.output = 0
  const modern = era === 'modern'
  const response = await handler.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': modern ? '2026-07-28' : '2025-11-25',
        ...(modern ? { 'mcp-method': method } : {}),
        ...(modern && typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: modern ? { ...params, _meta: ENVELOPE } : params,
      }),
    }),
  )
  const text = await response.text()
  if (response.status !== 200) console.log(text)
  console.log(
    `${label.padEnd(28)} status ${response.status}  input conversions: ${counts.input}  output conversions: ${counts.output}`,
  )
}
await send('tools/list (2026)', 'modern', 'tools/list', {})
await send('tools/call echo (2026)', 'modern', 'tools/call', {
  name: 'echo',
  arguments: { message: 'hi' },
})
await send('tools/call echo (2025)', 'legacy', 'tools/call', {
  name: 'echo',
  arguments: { message: 'hi' },
})
await send('server/discover (2026)', 'modern', 'server/discover', {})
