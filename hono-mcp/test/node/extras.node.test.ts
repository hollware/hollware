import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { VersionNegotiationOptions } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vite-plus/test'

// Progress streaming, MRTR confirmations and tool scopes, served by the BUILT extras Worker in a real
// workerd with no Node.js compatibility (src/index-extras.ts, wrangler.extras.jsonc). Run against a
// server the caller started:
//   MCP_EXTRAS_URL=http://localhost:5207 vp test --root ../.. --project 'spike-hono-mcp:node' extras
// Skipped when MCP_EXTRAS_URL is not set. Fails when: progress notifications stop reaching the client,
// MRTR stops working for 2026-07-28 clients or starts working (or throwing differently) for 2025-11-25
// ones, a tool scope stops being enforced, or the gateway stops answering 401 without a token.

const base = process.env.MCP_EXTRAS_URL
const MODERN: VersionNegotiationOptions = { mode: { pin: '2026-07-28' } }

async function connect(
  path: string,
  options: {
    modern: boolean
    elicitation?: boolean
    accept?: boolean
    headers?: Record<string, string>
  },
) {
  const asked: string[] = []
  const client = new Client(
    { name: 'extras-test', version: '0.0.0' },
    {
      capabilities: options.elicitation ? { elicitation: { form: {} } } : {},
      ...(options.modern ? { versionNegotiation: MODERN } : {}),
    },
  )
  if (options.elicitation) {
    client.setRequestHandler('elicitation/create', (request) => {
      asked.push(request.params.message)
      return { action: options.accept === false ? 'decline' : 'accept', content: { confirm: true } }
    })
  }
  const requestInit = options.headers ? { headers: options.headers } : undefined
  await client.connect(
    new StreamableHTTPClientTransport(new URL(path, base ?? 'http://localhost:0'), { requestInit }),
  )
  return { client, asked }
}

describe.skipIf(base === undefined)(
  'what the plan relies on, in a real workerd without Node',
  () => {
    it('has no Node.js globals and still serves the library', async () => {
      const report = JSON.parse(await (await fetch(new URL('/__runtime', base))).text())

      expect(report.globals).toEqual({
        process: 'undefined',
        Buffer: 'undefined',
        setImmediate: 'undefined',
        require: 'undefined',
        userAgent: 'Cloudflare-Workers',
      })
      expect(report.mcp.status).toBe(200)
    })

    it.each([
      ['2026-07-28', true],
      ['2025-11-25', false],
    ])('streams progress notifications before the result (%s client)', async (_era, modern) => {
      const { client } = await connect('/progress', { modern })
      const progress: number[] = []

      const result = await client.callTool(
        { name: 'slow', arguments: {} },
        { onprogress: (update) => progress.push(update.progress) },
      )

      expect(progress).toEqual([1, 2, 3])
      expect(result.content).toEqual([{ type: 'text', text: 'done' }])
      await client.close()
    })

    it('completes an MRTR confirmation for a 2026-07-28 client', async () => {
      const { client, asked } = await connect('/mrtr', { modern: true, elicitation: true })

      const result = await client.callTool({ name: 'confirm_delete', arguments: { id: 'note-1' } })

      expect(result.content).toEqual([{ type: 'text', text: 'deleted note-1' }])
      expect(asked).toEqual(['Delete note-1?'])
      await client.close()
    })

    it('ends an MRTR confirmation the user declines', async () => {
      const { client } = await connect('/mrtr', { modern: true, elicitation: true, accept: false })

      const result = await client.callTool({ name: 'confirm_delete', arguments: { id: 'note-1' } })

      expect(result.content).toEqual([{ type: 'text', text: 'kept note-1' }])
      await client.close()
    })

    it('cannot ask a 2025-11-25 client, even one that declares elicitation', async () => {
      const { client, asked } = await connect('/mrtr', { modern: false, elicitation: true })

      const result = await client.callTool({ name: 'confirm_delete', arguments: { id: 'note-1' } })

      expect(result.isError).toBe(true)
      expect(asked).toEqual([])
      await client.close()
    })

    it('answers 401 without a token (the gateway), 403 without the scope, and runs with it', async () => {
      const anonymous = await fetch(new URL('/scoped', base), { method: 'POST', body: '{}' })
      expect(anonymous.status).toBe(401)
      expect(anonymous.headers.get('www-authenticate')).toBe('Bearer')

      const reader = await connect('/scoped', {
        modern: true,
        headers: { 'x-test-scopes': 'content:read' },
      })
      await expect(reader.client.callTool({ name: 'write_thing', arguments: {} })).rejects.toThrow()
      expect((await reader.client.callTool({ name: 'whoami', arguments: {} })).content).toEqual([
        { type: 'text', text: '{"clientId":"test-client","scopes":["content:read"]}' },
      ])
      await reader.client.close()

      const writer = await connect('/scoped', {
        modern: true,
        headers: { 'x-test-scopes': 'content:read,content:write' },
      })
      expect(
        (await writer.client.callTool({ name: 'write_thing', arguments: {} })).content,
      ).toEqual([{ type: 'text', text: 'written' }])
      await writer.client.close()
    })
  },
)
