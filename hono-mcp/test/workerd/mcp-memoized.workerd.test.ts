import { createMcpHandler } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import { memoizeJsonSchema } from '../../src/mcp/memoize.ts'
import { echoInput } from '../../src/mcp/schemas.ts'
import { buildMemoizedServer } from '../../src/mcp/server-memoized.ts'
import { TOOLS_LIST_LEGACY, TOOLS_LIST_MODERN } from './golden.ts'
import { legacyRpc, modernRpc } from './helpers.ts'

// Fails when: memoizing the JSON Schema conversion changes what tools/list advertises by one byte,
// stops Zod from validating and applying defaults, or recomputes the conversion on every call.

const handler = createMcpHandler(buildMemoizedServer)
const askModern = (method: string, params: Record<string, unknown> = {}) =>
  modernRpc(method, params, 1, (request) => handler.fetch(request))
const askLegacy = (method: string, params: Record<string, unknown> = {}) =>
  legacyRpc(method, params, 1, (request) => handler.fetch(request))

describe('the memoized-Zod server', () => {
  it('advertises exactly the bytes the plain Zod server advertises, in both eras', async () => {
    expect((await askModern('tools/list')).text).toBe(TOOLS_LIST_MODERN)
    expect((await askLegacy('tools/list')).text).toBe(TOOLS_LIST_LEGACY)
  })

  it('still validates with Zod: the same message, the Zod default applied', async () => {
    const invalid = await askModern('tools/call', { name: 'echo', arguments: { message: '' } })
    const created = await askModern('tools/call', {
      name: 'create_note',
      arguments: { title: 'Memo', body: 'b' },
    })

    expect(invalid.message.result).toMatchObject({
      content: [
        {
          type: 'text',
          text: 'Input validation error: Invalid arguments for tool echo: message: Too small: expected string to have >=1 characters',
        },
      ],
      isError: true,
    })
    expect(created.message.result).toMatchObject({
      structuredContent: {
        outcome: 'created',
        note: { id: 'note-memo', title: 'Memo', version: 1, tags: [] },
      },
    })
  })

  it('converts a schema to JSON Schema once per target and io, then reuses the object', () => {
    let conversions = 0
    const standard = echoInput['~standard']
    const counting = {
      '~standard': {
        ...standard,
        jsonSchema: {
          input: (options: { target: string }) => {
            conversions += 1
            return standard.jsonSchema.input(options)
          },
          output: standard.jsonSchema.output,
        },
      },
    }
    const memoized = memoizeJsonSchema(counting)

    const first = memoized['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
    const second = memoized['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
    memoized['~standard'].jsonSchema.input({ target: 'draft-07' })

    expect(conversions).toBe(2)
    expect(second).toBe(first)
    expect(first).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        message: { type: 'string', minLength: 1, maxLength: 200, description: 'Text to echo back' },
      },
      required: ['message'],
    })
  })
})
