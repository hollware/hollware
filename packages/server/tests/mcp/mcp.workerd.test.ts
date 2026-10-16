import { fromJsonSchema } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'

import {
  callRaw,
  CANNED,
  connect,
  endpointWith,
  ENTRY_ID,
  INPUTS,
  rpc,
  textOf,
  tokenPrincipal,
  type Overrides,
} from './support.ts'

// Fails when: the endpoint stops serving a 2026 client (discover, list, call) and a 2025 client
// (initialize, list, call) inside workerd; a structured answer stops matching the output schema
// the tool advertises, as the client's own validator checks it; a call stops being refused 403
// when the token lacks its scope; `publish` stops asking a 2026 client the question over MRTR and
// publishing with the warnings it accepts; `tools/list` stops being the same bytes on every call;
// or the SDK stops choosing its Cloudflare Worker JSON Schema validator in workerd, where Ajv
// cannot run because it needs to compile code.

const TITLE = { contract: 'seo-title-length', path: '/frontmatter/title' }
const ALT = { contract: 'image-alt', path: '/body' }

const publishAfterAsking: Overrides = {
  publish: async (input) =>
    input.acknowledgeWarnings.length >= 2
      ? CANNED.publish.published
      : CANNED.publish.needs_acknowledgement,
}

describe('the MCP endpoint in workerd', () => {
  it.each(['2026', '2025'] as const)(
    'serves a %s client: it lists the tools and calls them, and the answers match their schemas',
    async (era) => {
      const { endpoint, seen } = endpointWith()
      const { client } = await connect(endpoint, { era })

      const { tools } = await client.listTools()
      const found = await client.callTool({ name: 'get_entry', arguments: INPUTS.get_entry })
      const published = await client.callTool({
        name: 'publish',
        arguments: INPUTS.publish,
      })

      expect(tools.map((tool) => tool.name)).toEqual([
        'approve_review',
        'comment_review',
        'content_stats',
        'create_draft',
        'create_site',
        'delete_site',
        'describe_site',
        'get_entry',
        'get_structure',
        'get_translations',
        'list_entries',
        'list_reviews',
        'make_webhook_secret',
        'publish',
        'request_changes',
        'request_review',
        'restore_site',
        'search',
        'set_collection',
        'unpublish',
        'update_draft',
        'update_site',
        'validate',
      ])
      expect(found.isError).toBe(false)
      expect(found.structuredContent).toEqual(CANNED.get_entry.ok)
      expect(published.structuredContent).toEqual(CANNED.publish.published)
      expect(seen.map((call) => call.tool)).toEqual(['get_entry', 'publish'])
      await client.close()
    },
  )

  it('answers an error outcome with isError, and an error that is not an outcome with its code', async () => {
    const { endpoint } = endpointWith(
      {
        update_draft: async () => {
          throw new Error('no one needs to know')
        },
      },
      { outcomes: { get_entry: 'not_found' } },
    )
    const { client } = await connect(endpoint, { era: '2026' })

    const notFound = await client.callTool({ name: 'get_entry', arguments: INPUTS.get_entry })
    const failed = await client.callTool({ name: 'update_draft', arguments: INPUTS.update_draft })

    expect([notFound.isError, notFound.structuredContent]).toEqual([
      true,
      CANNED.get_entry.not_found,
    ])
    expect(failed.isError).toBe(true)
    expect(failed.structuredContent).toBeUndefined()
    expect(textOf({ content: failed.content })).toMatchObject({
      code: 'internal',
      message: 'The operation failed on the server.',
    })
    await client.close()
  })

  it('refuses a token without the scope with the step-up error, and the handler does not run', async () => {
    const { endpoint, seen } = endpointWith()
    const { client } = await connect(endpoint, {
      era: '2026',
      principal: tokenPrincipal(['content:read']),
    })

    await expect(
      client.callTool({ name: 'unpublish', arguments: { id: ENTRY_ID } }),
    ).rejects.toThrow('Insufficient scope: required "content:publish"')

    expect(seen).toEqual([])
    await client.close()
  })

  it('asks a 2026 client that can show a form, and publishes with the warnings it accepts', async () => {
    const { endpoint, seen } = endpointWith(publishAfterAsking)
    const questions: string[] = []
    const { client } = await connect(endpoint, {
      era: '2026',
      capabilities: { elicitation: { form: {} } },
      elicit: (message) => {
        questions.push(message)
        return { action: 'accept', content: { acknowledge: true } }
      },
    })

    const result = await client.callTool({ name: 'publish', arguments: INPUTS.publish })

    expect(result.structuredContent).toEqual(CANNED.publish.published)
    expect(questions).toHaveLength(1)
    expect(seen.map((call) => call.input)).toEqual([
      { id: ENTRY_ID, version: 1, acknowledgeWarnings: [], group: [] },
      { id: ENTRY_ID, version: 1, acknowledgeWarnings: [TITLE, ALT], group: [] },
    ])
    await client.close()
  })

  it('leaves a 2025 client to acknowledge the warnings itself', async () => {
    const { endpoint } = endpointWith(publishAfterAsking)
    const { client } = await connect(endpoint, { era: '2025' })

    const first = await client.callTool({ name: 'publish', arguments: INPUTS.publish })
    const second = await client.callTool({
      name: 'publish',
      arguments: { ...INPUTS.publish, acknowledgeWarnings: [TITLE, ALT] },
    })

    expect(first.structuredContent).toEqual(CANNED.publish.needs_acknowledgement)
    expect(second.structuredContent).toEqual(CANNED.publish.published)
    await client.close()
  })

  it.each(['modern', 'legacy'] as const)('lists the same bytes on every call (%s)', async (era) => {
    const { endpoint } = endpointWith()

    const first = await rpc(endpoint, era, 'tools/list')
    const second = await rpc(endpoint, era, 'tools/list')
    const call = await callRaw(endpoint, era, 'list_entries', INPUTS.list_entries)
    const third = await rpc(endpoint, era, 'tools/list')

    expect(first.text.length).toBeGreaterThan(20_000)
    expect(second.text).toBe(first.text)
    expect(third.text).toBe(first.text)
    expect(call.result.isError).toBe(false)
  })

  it('has the SDK choose the Cloudflare Worker JSON Schema validator, which needs no code generation', () => {
    const schema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
    }

    // Ajv compiles code and cannot do it in workerd; this is how @cfworker/json-schema words it.
    expect(fromJsonSchema(schema)['~standard'].validate({ a: 1 })).toEqual({
      issues: [
        {
          message:
            '#: Property "a" does not match schema.; #/a: Instance type "number" is invalid. Expected "string".',
        },
      ],
    })
  })
})
