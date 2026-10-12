import { describe, expect, it } from 'vitest'
import { legacyRpc, modernRpc } from './helpers.ts'

// S2a / S2c. Fails when: a tool stops answering with the literal result below, input validation
// stops running inside workerd (the Zod path needs no JSON Schema validator: Zod validates itself),
// a failing tool stops reporting isError, or an unknown tool stops being a JSON-RPC error.

const SERVER_INFO_META = {
  'io.modelcontextprotocol/serverInfo': { name: 'spike-hono-mcp', version: '0.0.0' },
}

describe('the three tools, 2026-07-28 era', () => {
  it('echo (read tool) returns structured output', async () => {
    const answer = await modernRpc('tools/call', { name: 'echo', arguments: { message: 'hello' } })

    expect(answer.status).toBe(200)
    expect(answer.message).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [{ type: 'text', text: '{"echoed":"hello","length":5}' }],
        structuredContent: { echoed: 'hello', length: 5 },
        resultType: 'complete',
        _meta: SERVER_INFO_META,
      },
    })
  })

  it('create_note (write tool) returns structured output and applies the Zod default', async () => {
    const answer = await modernRpc('tools/call', {
      name: 'create_note',
      arguments: { title: 'Hello World', body: '# Hi' },
    })

    expect(answer.message.result).toEqual({
      content: [
        {
          type: 'text',
          text: '{"outcome":"created","note":{"id":"note-hello-world","title":"Hello World","version":1,"tags":[]}}',
        },
      ],
      structuredContent: {
        outcome: 'created',
        note: { id: 'note-hello-world', title: 'Hello World', version: 1, tags: [] },
      },
      resultType: 'complete',
      _meta: SERVER_INFO_META,
    })
  })

  it('always_fails reports a returned tool error', async () => {
    const answer = await modernRpc('tools/call', {
      name: 'always_fails',
      arguments: { mode: 'return' },
    })

    expect(answer.status).toBe(200)
    expect(answer.message.result).toEqual({
      content: [{ type: 'text', text: 'Draft is locked by another writer (returned)' }],
      isError: true,
      resultType: 'complete',
      _meta: SERVER_INFO_META,
    })
  })

  it('always_fails reports a thrown error the same way', async () => {
    const answer = await modernRpc('tools/call', {
      name: 'always_fails',
      arguments: { mode: 'throw' },
    })

    expect(answer.message.result).toEqual({
      content: [{ type: 'text', text: 'Draft is locked by another writer (thrown)' }],
      isError: true,
      resultType: 'complete',
      _meta: SERVER_INFO_META,
    })
  })
})

describe('input validation inside workerd (S2c)', () => {
  it.each([
    [
      'an empty string',
      { message: '' },
      'Input validation error: Invalid arguments for tool echo: message: Too small: expected string to have >=1 characters',
    ],
    [
      'a missing argument',
      {},
      'Input validation error: Invalid arguments for tool echo: message: Invalid input: expected string, received undefined',
    ],
    [
      'the wrong type',
      { message: 42 },
      'Input validation error: Invalid arguments for tool echo: message: Invalid input: expected string, received number',
    ],
  ])('answers %s with a tool error the model can read', async (_label, args, text) => {
    const answer = await modernRpc('tools/call', { name: 'echo', arguments: args })

    expect(answer.status).toBe(200)
    expect(answer.message.result).toEqual({
      content: [{ type: 'text', text }],
      isError: true,
      resultType: 'complete',
      _meta: SERVER_INFO_META,
    })
  })

  it('answers an unknown tool with a JSON-RPC error, not a tool result', async () => {
    const answer = await modernRpc('tools/call', { name: 'nope', arguments: {} })

    expect(answer.status).toBe(200)
    expect(answer.message).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32602, message: 'Tool nope not found' },
    })
  })

  it('answers a modern request without the _meta envelope with 400 / -32602', async () => {
    const { exports } = await import('cloudflare:workers')
    const response = await exports.default.fetch('http://spike.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: {
        code: -32602,
        message:
          'Invalid params: the MCP-Protocol-Version header names protocol revision 2026-07-28, but the request is missing the required per-request envelope key(s): _meta',
        data: { envelope: { missing: ['_meta'] } },
      },
    })
  })

  it.each([
    [
      'without Mcp-Name',
      { 'mcp-method': 'tools/call' },
      'Bad Request: the request headers and body disagree: the body carries params.name="echo" but the required Mcp-Name header is absent',
    ],
    [
      'with an Mcp-Name that names another tool',
      { 'mcp-method': 'tools/call', 'mcp-name': 'other' },
      'Bad Request: the request headers and body disagree: the body carries params.name="echo" but the Mcp-Name header names "other"',
    ],
    [
      'without Mcp-Method',
      {},
      'Bad Request: the request headers and body disagree: the body names method tools/call but the required Mcp-Method header is absent',
    ],
  ])('answers a modern tools/call %s with 400 / -32020', async (_label, extraHeaders, message) => {
    const { exports } = await import('cloudflare:workers')
    const response = await exports.default.fetch('http://spike.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        ...extraHeaders,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: { message: 'hi' },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 9,
      error: { code: -32020, message },
    })
  })

  it('answers an unsupported modern revision with 400 / -32022 naming what is supported', async () => {
    const { exports } = await import('cloudflare:workers')
    const response = await exports.default.fetch('http://spike.test/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2099-01-01',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2099-01-01',
            'io.modelcontextprotocol/clientInfo': { name: 'future', version: '0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 8,
      error: {
        code: -32022,
        message: 'Unsupported protocol version: 2099-01-01',
        data: { supported: ['2026-07-28'], requested: '2099-01-01' },
      },
    })
  })
})

describe('the same tools, 2025-11-25 era', () => {
  it('create_note answers without resultType or _meta, as an SSE event', async () => {
    const answer = await legacyRpc('tools/call', {
      name: 'create_note',
      arguments: { title: 'Legacy Note', body: 'b', tags: ['a', 'b'] },
    })

    expect(answer.status).toBe(200)
    expect(answer.contentType).toBe('text/event-stream')
    expect(answer.message).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [
          {
            type: 'text',
            text: '{"outcome":"created","note":{"id":"note-legacy-note","title":"Legacy Note","version":1,"tags":["a","b"]}}',
          },
        ],
        structuredContent: {
          outcome: 'created',
          note: { id: 'note-legacy-note', title: 'Legacy Note', version: 1, tags: ['a', 'b'] },
        },
      },
    })
  })

  it('invalid input is the same tool error', async () => {
    const answer = await legacyRpc('tools/call', { name: 'echo', arguments: { message: '' } })

    expect(answer.message.result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Input validation error: Invalid arguments for tool echo: message: Too small: expected string to have >=1 characters',
        },
      ],
      isError: true,
    })
  })

  it('always_fails is the same tool error', async () => {
    const answer = await legacyRpc('tools/call', {
      name: 'always_fails',
      arguments: { mode: 'throw' },
    })

    expect(answer.message.result).toEqual({
      content: [{ type: 'text', text: 'Draft is locked by another writer (thrown)' }],
      isError: true,
    })
  })
})
