import { createMcpHandler, fromJsonSchema } from '@modelcontextprotocol/server'
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker'
import { describe, expect, it } from 'vitest'
import { buildPrecomputedServer } from '../../src/mcp/server-precomputed.ts'
import { createNoteInput } from '../../src/mcp/schemas.ts'
import { TOOLS_LIST_LEGACY, TOOLS_LIST_MODERN } from './golden.ts'
import { legacyRpc, modernRpc } from './helpers.ts'

// S2e fallback. Fails when: the precomputed server stops advertising byte-for-byte what the Zod
// server advertises, tools/call input validation through `fromJsonSchema` stops working inside
// workerd, or the validator stops being the @cfworker/json-schema one (Ajv needs `new Function`).

const handler = createMcpHandler(buildPrecomputedServer)
const askModern = (method: string, params: Record<string, unknown> = {}) =>
  modernRpc(method, params, 1, (request) => handler.fetch(request))
const askLegacy = (method: string, params: Record<string, unknown> = {}) =>
  legacyRpc(method, params, 1, (request) => handler.fetch(request))

const META = { 'io.modelcontextprotocol/serverInfo': { name: 'spike-hono-mcp', version: '0.0.0' } }

describe('the precomputed-schema server (fromJsonSchema)', () => {
  it('advertises exactly the bytes the Zod server advertises, in both eras', async () => {
    expect((await askModern('tools/list')).text).toBe(TOOLS_LIST_MODERN)
    expect((await askLegacy('tools/list')).text).toBe(TOOLS_LIST_LEGACY)
  })

  it('discovers the same capabilities: tools, listChanged false', async () => {
    const answer = await askModern('server/discover')

    expect(answer.message.result).toMatchObject({
      supportedVersions: ['2026-07-28'],
      capabilities: { tools: { listChanged: false } },
    })
  })

  it('runs a valid call the same way', async () => {
    const answer = await askModern('tools/call', { name: 'echo', arguments: { message: 'hi' } })

    expect(answer.message.result).toEqual({
      content: [{ type: 'text', text: '{"echoed":"hi","length":2}' }],
      structuredContent: { echoed: 'hi', length: 2 },
      resultType: 'complete',
      _meta: META,
    })
  })

  it('leaves the create_note default to the handler: no tags in, tags [] out', async () => {
    const answer = await askModern('tools/call', {
      name: 'create_note',
      arguments: { title: 'Plain', body: 'b' },
    })

    expect(answer.message.result).toEqual({
      content: [
        {
          type: 'text',
          text: '{"outcome":"created","note":{"id":"note-plain","title":"Plain","version":1,"tags":[]}}',
        },
      ],
      structuredContent: {
        outcome: 'created',
        note: { id: 'note-plain', title: 'Plain', version: 1, tags: [] },
      },
      resultType: 'complete',
      _meta: META,
    })
  })

  it.each([
    [
      'an empty string',
      'echo',
      { message: '' },
      'Input validation error: Invalid arguments for tool echo: #: Property "message" does not match schema.; #/message: String is too short (0 < 1).',
    ],
    [
      'a missing argument',
      'echo',
      {},
      'Input validation error: Invalid arguments for tool echo: #: Instance does not have required property "message".',
    ],
    [
      'the wrong type',
      'echo',
      { message: 42 },
      'Input validation error: Invalid arguments for tool echo: #: Property "message" does not match schema.; #/message: Instance type "number" is invalid. Expected "string".',
    ],
    [
      'a bad array item',
      'create_note',
      { title: 'T', body: 'b', tags: [''] },
      'Input validation error: Invalid arguments for tool create_note: #: Property "tags" does not match schema.; #/tags: Items did not match schema.; #/tags/0: String is too short (0 < 1).',
    ],
    [
      'a value outside the enum',
      'always_fails',
      { mode: 'x' },
      'Input validation error: Invalid arguments for tool always_fails: #: Property "mode" does not match schema.; #/mode: Instance does not match any of ["return","throw"].',
    ],
  ])('still validates %s with the JSON Schema validator', async (_label, name, args, text) => {
    const answer = await askModern('tools/call', { name, arguments: args })

    expect(answer.status).toBe(200)
    expect(answer.message.result).toEqual({
      content: [{ type: 'text', text }],
      isError: true,
      resultType: 'complete',
      _meta: META,
    })
  })

  it('does not apply Zod defaults: that is the handler job now', async () => {
    const schema = fromJsonSchema({
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' }, default: [] } },
    })

    // JSON Schema validation returns the value untouched ...
    expect(schema['~standard'].validate({})).toEqual({ value: {} })
    // ... Zod fills the default in.
    expect(createNoteInput.parse({ title: 't', body: 'b' })).toEqual({
      title: 't',
      body: 'b',
      tags: [],
    })
  })

  it('selects the @cfworker/json-schema validator by default, and accepts it explicitly', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    } as const
    const viaDefault = fromJsonSchema(schema)['~standard'].validate({ a: 1 })
    const viaExplicit = fromJsonSchema(schema, new CfWorkerJsonSchemaValidator())[
      '~standard'
    ].validate({ a: 1 })

    const expected = {
      issues: [
        {
          message:
            '#: Property "a" does not match schema.; #/a: Instance type "number" is invalid. Expected "string".',
        },
      ],
    }
    expect(viaDefault).toEqual(expected)
    expect(viaExplicit).toEqual(expected)
  })
})
