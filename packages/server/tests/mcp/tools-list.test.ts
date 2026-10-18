import { createDraft, OPERATIONS, publish } from '@hollware/core'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { createToolTable, memoizeJsonSchema } from '../../src/mcp/tools.ts'
import {
  ALL_SCOPES,
  callRaw,
  connect,
  endpointWith,
  ENTRY_ID,
  INPUTS,
  makeCall,
  rpc,
  tokenPrincipal,
} from './support.ts'

// Fails when: the tools stop being one for each operation, sorted by name, with the title, the
// description, the annotations of the effect and the schemas of their spec; `tools/list` differs
// between calls, endpoints, principals or eras (apart from the cache hint, which is 2026 only);
// the list says it can change, or that it may be cached for any time but five minutes, by anyone;
// the schemas are converted to JSON Schema again on each request; or an operation that asks for
// no scope becomes a tool.

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
const CHANGE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}
const DESTROY = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
}

const TOOLS = [
  { name: 'approve_review', title: 'Approve a review', annotations: CHANGE },
  { name: 'comment_review', title: 'Comment on a review', annotations: CHANGE },
  { name: 'content_stats', title: 'Read what readers read', annotations: READ },
  { name: 'create_draft', title: 'Create a draft', annotations: CHANGE },
  { name: 'create_site', title: 'Create a site', annotations: CHANGE },
  { name: 'delete_entry', title: 'Move an entry to the trash', annotations: DESTROY },
  { name: 'delete_site', title: 'Put a site in the trash', annotations: DESTROY },
  { name: 'describe_site', title: 'Describe the site', annotations: READ },
  { name: 'get_asset', title: 'Get an image', annotations: READ },
  { name: 'get_entry', title: 'Get an entry', annotations: READ },
  { name: 'get_revision', title: 'Get a revision of an entry', annotations: READ },
  { name: 'get_structure', title: 'Get the structure of the site', annotations: READ },
  { name: 'get_translations', title: 'Get the translations of an entry', annotations: READ },
  { name: 'list_assets', title: 'List the images of the site', annotations: READ },
  { name: 'list_entries', title: 'List entries', annotations: READ },
  { name: 'list_reviews', title: 'List the reviews', annotations: READ },
  { name: 'list_revisions', title: 'List the revisions of an entry', annotations: READ },
  { name: 'make_webhook_secret', title: 'Make the secret of a webhook', annotations: CHANGE },
  { name: 'publish', title: 'Publish an entry', annotations: CHANGE },
  { name: 'request_changes', title: 'Ask for changes', annotations: CHANGE },
  { name: 'request_review', title: 'Ask for a review', annotations: CHANGE },
  { name: 'restore_entry', title: 'Bring an entry back from the trash', annotations: CHANGE },
  { name: 'restore_revision', title: 'Go back to a revision', annotations: CHANGE },
  { name: 'restore_site', title: 'Bring a site back from the trash', annotations: CHANGE },
  { name: 'search', title: 'Search entries', annotations: READ },
  { name: 'set_collection', title: 'Add, change or remove a collection', annotations: DESTROY },
  { name: 'unpublish', title: 'Unpublish an entry', annotations: DESTROY },
  { name: 'update_draft', title: 'Update a draft', annotations: CHANGE },
  { name: 'update_site', title: 'Change the structure of the site', annotations: DESTROY },
  { name: 'upload_asset', title: 'Upload an image', annotations: CHANGE },
  { name: 'validate', title: 'Validate a Markdown file', annotations: READ },
]

const OUTCOMES: Record<string, string[]> = {
  approve_review: ['published', 'blocked', 'needs_acknowledgement', 'not_pending', 'not_found'],
  comment_review: ['commented', 'not_pending', 'not_found'],
  content_stats: ['ok', 'unavailable'],
  create_draft: ['saved', 'refused', 'in_trash'],
  create_site: ['created', 'taken', 'invalid'],
  delete_entry: ['trashed', 'published', 'conflict', 'not_found'],
  delete_site: ['trashed', 'needs_confirmation', 'not_found'],
  describe_site: ['ok'],
  get_entry: ['ok', 'not_found'],
  get_structure: ['ok'],
  get_translations: ['ok', 'not_found'],
  list_entries: ['ok'],
  list_reviews: ['ok'],
  make_webhook_secret: ['made', 'not_found', 'unavailable'],
  upload_asset: ['created', 'exists', 'refused', 'unavailable'],
  list_assets: ['ok'],
  get_asset: ['ok', 'not_found'],
  list_revisions: ['ok', 'not_found'],
  get_revision: ['ok', 'not_found'],
  restore_revision: ['saved', 'unchanged', 'conflict', 'not_found', 'refused'],
  publish: [
    'published',
    'scheduled',
    'blocked',
    'needs_acknowledgement',
    'pending_review',
    'conflict',
    'not_found',
  ],
  request_changes: ['changes_requested', 'not_pending', 'not_found'],
  request_review: ['pending_review', 'blocked', 'needs_acknowledgement', 'conflict', 'not_found'],
  restore_entry: ['restored', 'not_trashed', 'not_found'],
  restore_site: ['restored', 'not_found'],
  search: ['ok'],
  set_collection: ['updated', 'unchanged', 'invalid', 'needs_confirmation', 'conflict'],
  unpublish: ['unpublished', 'not_found'],
  update_draft: ['saved', 'unchanged', 'conflict', 'not_found', 'refused'],
  update_site: ['updated', 'unchanged', 'invalid', 'needs_confirmation', 'conflict'],
  validate: ['ok'],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('tools/list', () => {
  it.each(['2026', '2025'] as const)(
    'lists one tool for each operation, sorted by name, as a %s client reads it',
    async (era) => {
      const { endpoint } = endpointWith()
      const { client } = await connect(endpoint, { era })

      const { tools } = await client.listTools()

      expect(tools.map(({ name, title, annotations }) => ({ name, title, annotations }))).toEqual(
        TOOLS,
      )
      expect(tools.map((tool) => tool.description)).toEqual(
        OPERATIONS.map((operation) => operation.description),
      )
      expect(
        tools.map((tool) => {
          const properties = tool.outputSchema?.properties
          return typeof properties === 'object' && properties !== null && 'outcome' in properties
            ? properties.outcome
            : undefined
        }),
      ).toEqual(TOOLS.map(({ name }) => ({ type: 'string', enum: OUTCOMES[name] })))
      await client.close()
    },
  )

  it('shows the input and the output schemas of the spec', async () => {
    const { endpoint } = endpointWith()
    const { client } = await connect(endpoint, { era: '2026' })

    const { tools } = await client.listTools()

    const unpublish = tools.find((tool) => tool.name === 'unpublish')
    expect(unpublish?.inputSchema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        id: {
          type: 'string',
          pattern: '^ent_[0-9A-HJKMNP-TV-Z]{26}$',
          description: 'The id of an entry (ent_…), as the other operations return it.',
        },
      },
      required: ['id'],
      additionalProperties: false,
    })
    expect(Object.keys(unpublish?.outputSchema?.properties ?? {})).toEqual(['outcome', 'entry'])
    // The defaults are the SDK's own words for "optional": a client may leave them out.
    const publishTool = tools.find((tool) => tool.name === 'publish')
    expect(publishTool?.inputSchema.required).toEqual(['id', 'version'])
    for (const operation of OPERATIONS) {
      const tool = tools.find((candidate) => candidate.name === operation.name)
      expect(tool?.inputSchema, operation.name).toEqual(
        operation.input['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
      )
      expect(tool?.outputSchema, operation.name).toEqual(
        operation.output['~standard'].jsonSchema.output({ target: 'draft-2020-12' }),
      )
    }
    await client.close()
  })

  it.each(['modern', 'legacy'] as const)(
    'is the same bytes for every call, principal and endpoint (%s)',
    async (era) => {
      const first = endpointWith().endpoint
      const second = endpointWith().endpoint
      const reader = makeCall({ principal: tokenPrincipal(['content:read']), requestId: 'req_a' })
      const nobody = makeCall({ principal: tokenPrincipal([]), requestId: 'req_b' })
      const everything = makeCall({ principal: tokenPrincipal(ALL_SCOPES), requestId: 'req_c' })

      const answers = [
        await rpc(first, era, 'tools/list', {}, { call: reader }),
        await rpc(first, era, 'tools/list', {}, { call: reader }),
        await rpc(first, era, 'tools/list', {}, { call: nobody }),
        await rpc(first, era, 'tools/list', {}, { call: everything }),
        await rpc(second, era, 'tools/list', {}, { call: everything }),
      ]

      expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 200, 200])
      const [firstAnswer, ...others] = answers
      expect(firstAnswer?.text.length).toBeGreaterThan(20_000)
      for (const answer of others) expect(answer.text).toBe(firstAnswer?.text)
    },
  )

  it('says that the lists of tools and prompts never change, and that anyone may keep the tools for five minutes', async () => {
    const { endpoint } = endpointWith()

    const modern = await rpc(endpoint, 'modern', 'tools/list')
    const legacy = await rpc(endpoint, 'legacy', 'tools/list')
    const discover = await rpc(endpoint, 'modern', 'server/discover')
    const initialize = await rpc(endpoint, 'legacy', 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'raw-client', version: '0.0.0' },
    })

    expect(modern.result.ttlMs).toBe(300_000)
    expect(modern.result.cacheScope).toBe('public')
    expect(Object.keys(legacy.result)).toEqual(['tools'])
    expect(discover.result.capabilities).toEqual({
      tools: { listChanged: false },
      prompts: { listChanged: false },
    })
    expect(initialize.result.capabilities).toEqual({
      tools: { listChanged: false },
      prompts: { listChanged: false },
    })
    expect(initialize.result.serverInfo).toEqual({ name: 'hollware', version: '0.0.0' })
  })

  it('converts the schemas to JSON Schema once, whatever the number of requests or eras', async () => {
    const converters = OPERATIONS.flatMap((operation) => [
      vi.spyOn(operation.input['~standard'].jsonSchema, 'input'),
      vi.spyOn(operation.output['~standard'].jsonSchema, 'output'),
    ])
    const { endpoint } = endpointWith()

    await rpc(endpoint, 'modern', 'tools/list')
    await rpc(endpoint, 'modern', 'tools/list')
    await rpc(endpoint, 'legacy', 'tools/list')
    await callRaw(endpoint, 'modern', 'publish', INPUTS.publish)
    await callRaw(endpoint, 'legacy', 'create_draft', INPUTS.create_draft)
    await rpc(endpoint, 'modern', 'tools/list')

    expect(converters).toHaveLength(62)
    expect(converters.map((converter) => converter.mock.calls.length)).toEqual(
      Array.from({ length: 62 }, () => 1),
    )
  })
})

describe('the tool table', () => {
  it('sorts the operations by name, whatever order they come in', () => {
    const names = createToolTable([...OPERATIONS].reverse()).map((tool) => tool.spec.name)

    expect(names).toEqual([
      'approve_review',
      'comment_review',
      'content_stats',
      'create_draft',
      'create_site',
      'delete_entry',
      'delete_site',
      'describe_site',
      'get_asset',
      'get_entry',
      'get_revision',
      'get_structure',
      'get_translations',
      'list_assets',
      'list_entries',
      'list_reviews',
      'list_revisions',
      'make_webhook_secret',
      'publish',
      'request_changes',
      'request_review',
      'restore_entry',
      'restore_revision',
      'restore_site',
      'search',
      'set_collection',
      'unpublish',
      'update_draft',
      'update_site',
      'upload_asset',
      'validate',
    ])
  })

  it('refuses an operation that asks for no scope', () => {
    expect(() => createToolTable([{ ...createDraft, scopes: [] }])).toThrow(
      'create_draft asks for no scope; every tool needs at least one',
    )
  })
})

describe('the cached schemas', () => {
  it('validate and fill the defaults as the Zod schema does', async () => {
    const standard = memoizeJsonSchema(publish.input)['~standard']

    expect(await standard.validate({ id: ENTRY_ID, version: 3 })).toEqual({
      value: { id: ENTRY_ID, version: 3, acknowledgeWarnings: [], group: [] },
    })
    const refused = await standard.validate({ id: 'nope', version: 3 })
    expect(refused.issues?.map((issue) => issue.path)).toEqual([['id']])
  })

  it('keep the conversion of the input and of the output apart, and each target apart', () => {
    const zod = publish.input['~standard'].jsonSchema
    const memoized = memoizeJsonSchema(publish.input)['~standard'].jsonSchema
    const draft = { target: 'draft-2020-12' } as const
    const older = { target: 'draft-07' } as const

    const input = memoized.input(draft)
    const output = memoized.output(draft)
    const olderInput = memoized.input(older)

    expect(input).toEqual(zod.input(draft))
    expect(output).toEqual(zod.output(draft))
    expect(olderInput).toEqual(zod.input(older))
    // A field with a default is optional in what a client sends and always there in what it reads.
    expect(input.required).toEqual(['id', 'version'])
    expect(output.required).toEqual(['id', 'version', 'acknowledgeWarnings', 'group'])
    expect(olderInput).not.toEqual(input)
  })

  it('are converted again when the library is given options, which can change the result', () => {
    const schema = publish.input['~standard']
    const converter = vi.spyOn(schema.jsonSchema, 'input')
    const memoized = memoizeJsonSchema(publish.input)['~standard'].jsonSchema

    memoized.input({ target: 'draft-2020-12' })
    memoized.input({ target: 'draft-2020-12' })
    memoized.input({ target: 'draft-07' })
    memoized.input({ target: 'draft-07', libraryOptions: { unrepresentable: 'any' } })
    memoized.input({ target: 'draft-07', libraryOptions: { unrepresentable: 'any' } })

    expect(converter).toHaveBeenCalledTimes(4)
  })
})
