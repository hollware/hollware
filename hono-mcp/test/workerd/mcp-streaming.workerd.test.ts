import { describe, expect, it } from 'vitest'
import { createBaseApp } from '../../src/app.ts'
import { mcpRoute } from '../../src/mcp/route.ts'
import { buildProgressServer } from '../../src/mcp/server-progress.ts'

// Fails when: progress notifications emitted by a tool stop reaching the client while the handler is
// still running (the Hono route or the middleware starts buffering the stream), the response stops
// upgrading to text/event-stream when it carries related messages, or the Hono middleware header
// stops reaching a streamed response.

let handlerFinished = false

const app = createBaseApp()
app.all(
  '/mcp',
  mcpRoute((context) =>
    buildProgressServer(context, () => {
      handlerFinished = true
    }),
  ),
)

const ENVELOPE = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

async function stream(era: 'modern' | 'legacy') {
  handlerFinished = false
  const modern = era === 'modern'
  const response = await app.fetch(
    new Request('http://spike.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': modern ? '2026-07-28' : '2025-11-25',
        ...(modern ? { 'mcp-method': 'tools/call', 'mcp-name': 'slow' } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'slow',
          arguments: {},
          _meta: modern ? { ...ENVELOPE, progressToken: 'p1' } : { progressToken: 'p1' },
        },
      }),
    }),
    { APP_NAME: 'stream-test', ALLOWED_HOSTS: '' },
  )
  const chunks: { text: string; handlerFinished: boolean }[] = []
  const reader = response.body?.getReader()
  if (!reader) throw new Error('no body')
  const decoder = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push({ text: decoder.decode(value), handlerFinished })
  }
  return { response, chunks }
}

const progressEvent = (step: number) =>
  `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"p1","progress":${step},"total":3,"message":"step ${step}"}}\n\n`

describe('progress notifications through the Hono route', () => {
  it.each([['modern'], ['legacy']] as const)(
    'reach the client while the handler still runs (%s era)',
    async (era) => {
      const { response, chunks } = await stream(era)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/event-stream')
      expect(response.headers.get('x-spike-app')).toBe('stream-test')
      expect(chunks.map((chunk) => chunk.text)).toEqual([
        progressEvent(1),
        progressEvent(2),
        progressEvent(3),
        era === 'modern'
          ? 'event: message\ndata: {"result":{"content":[{"type":"text","text":"done"}],"resultType":"complete","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"progress","version":"0.0.0"}}},"jsonrpc":"2.0","id":1}\n\n'
          : 'event: message\ndata: {"result":{"content":[{"type":"text","text":"done"}]},"jsonrpc":"2.0","id":1}\n\n',
      ])
      // The three progress events arrived before the handler returned: the stream is not buffered.
      expect(chunks.map((chunk) => chunk.handlerFinished)).toEqual([false, false, false, true])
    },
  )
})
