import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import {
  agentWith,
  createPlaygroundHarness,
  migrate,
  seedOwnerToken,
  seedToken,
} from '../v0.1/support/harness.ts'

// Fails when: the built playground stops letting an agent shape its site over MCP with no deploy
// (AC-0.8-3, ADR-033): a token with schema:admin reads the structure, adds a required field to the
// blog with set_collection, and the next create_draft is checked against it at once; a token
// without schema:admin is refused before anything changes.

const server = createPlaygroundHarness()
let owner = ''
let writer = ''

beforeAll(async () => {
  await server.listen()
  await migrate(server)
  owner = await seedOwnerToken(server)
  writer = await seedToken(server, { scopes: ['content:read', 'content:write'] })
})

afterAll(async () => {
  await server.close()
})

interface Blog {
  readonly schema: { readonly properties: Record<string, unknown>; readonly required: string[] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The blog of a definition as get_structure answers it, with its schema's fields. */
function blogOf(definition: unknown): Blog & Record<string, unknown> {
  const collections = isRecord(definition) ? definition['collections'] : undefined
  const blog = isRecord(collections) ? collections['blog'] : undefined
  const schema = isRecord(blog) ? blog['schema'] : undefined
  const properties = isRecord(schema) ? schema['properties'] : undefined
  const required = isRecord(schema) ? schema['required'] : undefined
  if (!isRecord(blog) || !isRecord(schema) || !isRecord(properties) || !Array.isArray(required)) {
    throw new Error('the playground has no blog with a schema')
  }
  return { ...blog, schema: { ...schema, properties, required: required.map(String) } }
}

const DRAFT = [
  '---',
  'title: Shaped without a deploy',
  'description: A post written after the blog asked for a subtitle.',
  'date: 2026-10-16',
  'tags:',
  '  - acceptance',
  'translationGroup: shaped',
  '---',
  '',
  'Plain words.',
  '',
].join('\n')

describe('AC-0.8-3: an agent shapes its site over MCP', () => {
  it('adds a required field with set_collection, and the next draft is checked against it', async () => {
    const agent = agentWith(server, owner)
    const read = await agent.call('get_structure', {})
    const version = Number(read.output['version'])
    const blog = blogOf(read.output['definition'])
    const collection = {
      ...blog,
      schema: {
        ...blog.schema,
        properties: { ...blog.schema.properties, subtitle: { type: 'string', minLength: 1 } },
        required: [...blog.schema.required, 'subtitle'],
      },
    }

    const asked = await agent.call('set_collection', { version, name: 'blog', collection })
    const changed =
      asked.output['outcome'] === 'needs_confirmation'
        ? await agent.call('set_collection', { version, name: 'blog', collection, confirm: true })
        : asked
    const draft = await agent.call('create_draft', {
      collection: 'blog',
      locale: 'en',
      slug: 'shaped-without-a-deploy',
      markdown: DRAFT,
    })

    expect(changed.output).toEqual({ outcome: 'updated', version: version + 1 })
    const verdict = draft.output['verdict']
    const errors = isRecord(verdict) && Array.isArray(verdict['errors']) ? verdict['errors'] : []
    expect(errors.map((error: unknown) => (isRecord(error) ? error['path'] : null))).toEqual([
      '/frontmatter/subtitle',
    ])
  })

  it('refuses a token without schema:admin, and changes nothing', async () => {
    const before = await agentWith(server, owner).call('get_structure', {})
    // The gateway answers 403 with the scope it lacks, before any handler runs.
    const refused = agentWith(server, writer).call('update_site', {
      version: before.output['version'],
      definition: before.output['definition'],
    })
    await expect(refused).rejects.toThrow('update_site requires: schema:admin')
    const after = await agentWith(server, owner).call('get_structure', {})

    expect(after.output['version']).toBe(before.output['version'])
  })
})
