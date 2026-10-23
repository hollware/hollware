import { HollwareError, type OperationName } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { OUTPUT_CAP_BYTES } from '../../src/limits.ts'
import {
  callRaw,
  CANNED,
  cannedOutput,
  connect,
  endpointWith,
  ENTRY,
  ENTRY_ID,
  INPUTS,
  makeCall,
  SITE,
  STORE,
  CLOCK,
  SUMMARY,
  textOf,
  tokenPrincipal,
  type Overrides,
} from './support.ts'

const ERAS = ['2026', '2025'] as const
const RAW_ERAS = ['modern', 'legacy'] as const

const OUTCOMES = [
  ['create_draft', 'saved', false],
  ['create_draft', 'refused', true],
  ['describe_site', 'ok', false],
  ['get_entry', 'ok', false],
  ['get_entry', 'not_found', true],
  ['get_translations', 'ok', false],
  ['get_translations', 'not_found', true],
  ['list_entries', 'ok', false],
  ['publish', 'published', false],
  ['publish', 'blocked', true],
  ['publish', 'needs_acknowledgement', false],
  ['publish', 'conflict', true],
  ['publish', 'not_found', true],
  ['unpublish', 'unpublished', false],
  ['unpublish', 'not_found', true],
  ['update_draft', 'saved', false],
  ['update_draft', 'unchanged', false],
  ['update_draft', 'conflict', true],
  ['update_draft', 'not_found', true],
  ['update_draft', 'refused', true],
  ['validate', 'ok', false],
] as const

const LIST_TEXT =
  '{"outcome":"ok","entries":[{"id":"ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW","collection":"blog","locale":"en","slug":"hello-world","translationGroup":"hello","status":"draft","version":1,"frontmatter":{"title":"Hello world"},"tags":["news"],"hasUnpublishedChanges":false,"publishedAt":null,"scheduledAt":null,"deletedAt":null,"updatedAt":"2026-10-12T12:00:00.000Z"}],"nextCursor":null}'

const LIST_OUTPUT = {
  outcome: 'ok',
  entries: [
    {
      id: 'ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW',
      collection: 'blog',
      locale: 'en',
      slug: 'hello-world',
      translationGroup: 'hello',
      status: 'draft',
      version: 1,
      frontmatter: { title: 'Hello world' },
      tags: ['news'],
      hasUnpublishedChanges: false,
      publishedAt: null,
      scheduledAt: null,
      deletedAt: null,
      updatedAt: '2026-10-12T12:00:00.000Z',
    },
  ],
  nextCursor: null,
}

const NEVER = () => new Promise<never>(() => {})

describe('the result of a call', () => {
  for (const era of ERAS) {
    it.each(OUTCOMES)(
      `answers %s with the outcome %s and isError %s (${era} client)`,
      async (tool, outcome, isError) => {
        const { endpoint, seen } = endpointWith({}, { outcomes: { [tool]: outcome } })
        const { client } = await connect(endpoint, { era })

        const result = await client.callTool({ name: tool, arguments: INPUTS[tool] })

        expect(result.isError).toBe(isError)
        expect(result.structuredContent).toEqual(cannedOutput(tool, outcome))
        expect(result.content).toEqual([
          { type: 'text', text: JSON.stringify(cannedOutput(tool, outcome)) },
        ])
        expect(seen.map((call) => call.tool)).toEqual([tool])
        await client.close()
      },
    )
  }

  it('is, whole, what a 2026 client reads', async () => {
    const { endpoint } = endpointWith()

    const answer = await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries)

    expect(answer.status).toBe(200)
    expect(answer.result).toEqual({
      content: [{ type: 'text', text: LIST_TEXT }],
      structuredContent: LIST_OUTPUT,
      isError: false,
      resultType: 'complete',
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'hollware', version: '0.0.0' } },
    })
  })

  it('is, whole, what a 2025 client reads', async () => {
    const { endpoint } = endpointWith()

    const answer = await callRaw(endpoint, 'legacy', 'list_entries', INPUTS.list_entries)

    expect(answer.status).toBe(200)
    expect(answer.result).toEqual({
      content: [{ type: 'text', text: LIST_TEXT }],
      structuredContent: LIST_OUTPUT,
      isError: false,
    })
  })

  it('holds only what the output schema names, in the order of the schema', async () => {
    const leaky = { ...SUMMARY, secretColumn: 'a column of the table' }
    const answer = { nextCursor: null, debug: 'left in', entries: [leaky], outcome: 'ok' as const }
    const { endpoint } = endpointWith({ list_entries: async () => answer })

    const result = await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries)

    expect(result.result.structuredContent).toEqual(LIST_OUTPUT)
    expect(textOf(result.result)).toEqual(LIST_OUTPUT)
    const [block] = Array.isArray(result.result.content) ? result.result.content : []
    expect(block).toEqual({ type: 'text', text: LIST_TEXT })
  })
})

describe('what a handler gets', () => {
  it('is the site, the store and the clock of the gateway, and the principal and request id of the call', async () => {
    const principal = tokenPrincipal(['content:read'])
    const { endpoint, seen } = endpointWith()

    await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries, {
      call: makeCall({ principal, requestId: 'req_context_1' }),
    })

    const [call] = seen
    expect(call?.context.site).toBe(SITE)
    expect(call?.context.store).toBe(STORE)
    expect(call?.context.clock).toBe(CLOCK)
    expect(call?.context.principal).toBe(principal)
    expect(call?.context.requestId).toBe('req_context_1')
  })

  it('reads the head, whatever the gateway says', async () => {
    const { endpoint, seen } = endpointWith()
    const sneaky = { site: SITE, store: STORE, clock: CLOCK, view: 'published' }

    await callRaw(endpoint, 'modern', 'get_entry', INPUTS.get_entry, {
      call: { ...makeCall(), context: sneaky },
    })

    expect(seen.map((call) => call.context.view)).toEqual(['head'])
  })

  it('has the client as the 2026 envelope names it, and nothing else of it', async () => {
    const { endpoint, seen } = endpointWith()

    await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries, {
      clientInfo: {
        name: 'claude-code',
        version: '2.1.0',
        title: 'Claude Code',
        description: 'An agent that writes code',
      },
    })

    expect(seen[0]?.context.client).toEqual({
      name: 'claude-code',
      version: '2.1.0',
      title: 'Claude Code',
    })
  })

  it('cuts a client name that is too long, since it is stored with every write', async () => {
    const { endpoint, seen } = endpointWith()

    await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries, {
      clientInfo: { name: 'n'.repeat(500), version: 'v'.repeat(500), title: 't'.repeat(500) },
    })

    expect(seen[0]?.context.client).toEqual({
      name: 'n'.repeat(120),
      version: 'v'.repeat(120),
      title: 't'.repeat(120),
    })
  })

  it('has no client for a 2025 client: the stateless fallback keeps nothing of its initialize', async () => {
    const { endpoint, seen } = endpointWith()

    await callRaw(endpoint, 'legacy', 'list_entries', INPUTS.list_entries)

    expect(seen[0]?.context.client).toBeNull()
  })

  it('is the input as the schema parsed it, with its defaults', async () => {
    const { endpoint, seen } = endpointWith()

    await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries)
    await callRaw(endpoint, 'modern', 'get_entry', INPUTS.get_entry)
    await callRaw(endpoint, 'legacy', 'publish', INPUTS.publish)

    expect(seen.map((call) => call.input)).toEqual([
      { collection: 'blog', limit: 20 },
      {
        collection: 'blog',
        locale: 'en',
        slug: 'hello-world',
        formats: ['markdown'],
        published: false,
        related: false,
        references: false,
      },
      { id: ENTRY_ID, version: 1, acknowledgeWarnings: [], group: [] },
    ])
  })

  it.each([
    [
      'a slug that is not one',
      { ...INPUTS.create_draft, slug: 'Not A Slug' },
      'Input validation error: Invalid arguments for tool create_draft: slug: Invalid string: must match pattern /^[a-z0-9]+(?:-[a-z0-9]+)*$/',
    ],
    [
      'a field the spec does not know',
      { ...INPUTS.create_draft, extra: 1 },
      'Input validation error: Invalid arguments for tool create_draft: Unrecognized key: "extra"',
    ],
    [
      'a missing field',
      { collection: 'blog', locale: 'en', slug: 'hello-world' },
      'Input validation error: Invalid arguments for tool create_draft: markdown: Invalid input: expected string, received undefined',
    ],
  ])('is never made of %s: the SDK says why, and no handler runs', async (_label, args, text) => {
    const { endpoint, seen } = endpointWith()

    for (const era of RAW_ERAS) {
      const answer = await callRaw(endpoint, era, 'create_draft', args)

      expect(answer.status).toBe(200)
      expect(answer.result.isError).toBe(true)
      expect(answer.result.content).toEqual([{ type: 'text', text }])
    }
    expect(seen).toEqual([])
  })
})

describe('an error', () => {
  it.each(RAW_ERAS)(
    'of the handler that is a HollwareError is its code, message and fix, and no structured content (%s)',
    async (era) => {
      const failing: Overrides = {
        get_entry: async () => {
          throw new HollwareError(
            'unknown_collection',
            'The site has no collection "blogs".',
            'Use one of: blog.',
            { cause: new Error('looked in 1 collection') },
          )
        },
      }
      const { endpoint } = endpointWith(failing)

      const answer = await callRaw(endpoint, era, 'get_entry', INPUTS.get_entry)

      expect(answer.status).toBe(200)
      expect(answer.result.isError).toBe(true)
      expect(answer.result.content).toEqual([
        {
          type: 'text',
          text: '{"code":"unknown_collection","message":"The site has no collection \\"blogs\\".","fix":"Use one of: blog."}',
        },
      ])
      expect(answer.result).not.toHaveProperty('structuredContent')
      expect(answer.text).not.toContain('looked in 1 collection')
    },
  )

  it.each([
    ['an Error', () => new Error('D1_ERROR: no such table: entries'), 'D1_ERROR: no such table'],
    ['a string', () => 'a thrown string', 'a thrown string'],
    ['an object', () => ({ code: 'EWEIRD' }), '{"code":"EWEIRD"}'],
  ])(
    'of any other kind, such as %s, is internal with a fixed message and the request id',
    async (_label, thrown, detail) => {
      const failing: Overrides = {
        create_draft: async () => {
          throw thrown()
        },
      }
      const { endpoint, logs } = endpointWith(failing)

      const answer = await callRaw(endpoint, 'modern', 'create_draft', INPUTS.create_draft, {
        call: makeCall({ requestId: 'req_internal_1' }),
      })

      expect(answer.result.isError).toBe(true)
      expect(answer.result.content).toEqual([
        {
          type: 'text',
          text: '{"code":"internal","message":"The operation failed on the server.","fix":"Try again. If it keeps failing, give the site operator this request id: req_internal_1."}',
        },
      ])
      expect(answer.result).not.toHaveProperty('structuredContent')
      expect(answer.text).not.toContain(detail)
      expect(logs.map((entry) => entry.kind === 'call' && entry.detail)).toEqual([
        expect.stringContaining(detail),
      ])
    },
  )

  it('is internal when the handler answers something that is not an output of its spec', async () => {
    const { endpoint, logs } = endpointWith({
      // @ts-expect-error -- a handler that breaks its contract is the case under test.
      create_draft: async () => ({ outcome: 'created', entry: SUMMARY }),
    })

    const answer = await callRaw(endpoint, 'modern', 'create_draft', INPUTS.create_draft)

    expect(answer.result.isError).toBe(true)
    expect(textOf(answer.result)).toMatchObject({ code: 'internal' })
    expect(answer.result).not.toHaveProperty('structuredContent')
    expect(logs[0]).toMatchObject({
      kind: 'call',
      tool: 'create_draft',
      outcome: null,
      errorCode: 'internal',
      detail: expect.stringContaining(
        'create_draft answered something that is not an output of its spec: outcome:',
      ),
    })
  })

  it('is internal when the handler throws before it even returns a promise', async () => {
    const { endpoint } = endpointWith({
      validate: () => {
        throw new TypeError('not even a promise')
      },
    })

    const answer = await callRaw(endpoint, 'modern', 'validate', INPUTS.validate)

    expect(answer.result.isError).toBe(true)
    expect(textOf(answer.result)).toMatchObject({ code: 'internal' })
  })
})

describe('the output cap', () => {
  const entryWith = (markdown: string): Overrides => ({
    get_entry: async () => ({ outcome: 'ok', entry: { ...ENTRY, markdown } }),
  })
  const BASE_BYTES = 542

  it('lets through an answer of exactly the cap, and refuses one byte more', async () => {
    const atCap = endpointWith(entryWith('a'.repeat(OUTPUT_CAP_BYTES - BASE_BYTES)))
    const overCap = endpointWith(entryWith('a'.repeat(OUTPUT_CAP_BYTES - BASE_BYTES + 1)))

    const allowed = await callRaw(atCap.endpoint, 'modern', 'get_entry', INPUTS.get_entry)
    const refused = await callRaw(overCap.endpoint, 'modern', 'get_entry', INPUTS.get_entry)

    expect(OUTPUT_CAP_BYTES).toBe(1_048_576)
    expect(allowed.result.isError).toBe(false)
    expect(textOf(allowed.result)).toMatchObject({ outcome: 'ok' })
    expect(refused.result.isError).toBe(true)
    expect(refused.result.content).toEqual([
      {
        type: 'text',
        text: '{"code":"output_too_large","message":"The answer of get_entry is 1048577 bytes, over the cap of 1048576 bytes.","fix":"Ask for one format at a time with formats: markdown, document or html, instead of several together."}',
      },
    ])
    expect(refused.result).not.toHaveProperty('structuredContent')
  })

  it('counts UTF-8 bytes, not characters: an answer of 600,000 letters can be over the cap', async () => {
    const { endpoint } = endpointWith(entryWith('é'.repeat(600_000)))

    const answer = await callRaw(endpoint, 'modern', 'get_entry', INPUTS.get_entry)

    expect(answer.result.isError).toBe(true)
    expect(textOf(answer.result)).toMatchObject({
      code: 'output_too_large',
      message: 'The answer of get_entry is 1200542 bytes, over the cap of 1048576 bytes.',
    })
  })

  const HUGE = 'x'.repeat(1_100_000)
  const RAN =
    'The operation ran and its change may have been applied: read the entry with get_entry before you repeat it.'
  const SUMMARY_OF_HUGE = { ...SUMMARY, frontmatter: { title: HUGE } }
  const TOO_LARGE: [OperationName, Overrides, string][] = [
    [
      'create_draft',
      { create_draft: async () => ({ ...CANNED.create_draft.saved, entry: SUMMARY_OF_HUGE }) },
      RAN,
    ],
    [
      'describe_site',
      {
        describe_site: async () => ({
          outcome: 'ok',
          site: { ...CANNED.describe_site.ok.site, styleGuide: HUGE },
        }),
      },
      'The description of the site does not fit in one answer. Document fewer collections, components and contracts, or shorten their descriptions.',
    ],
    [
      'get_entry',
      entryWith(HUGE),
      'Ask for one format at a time with formats: markdown, document or html, instead of several together.',
    ],
    [
      'get_translations',
      { get_translations: async () => ({ outcome: 'ok', entries: [SUMMARY_OF_HUGE] }) },
      'The translations do not fit in one answer. Read each one with get_entry instead.',
    ],
    [
      'list_entries',
      {
        list_entries: async () => ({ outcome: 'ok', entries: [SUMMARY_OF_HUGE], nextCursor: null }),
      },
      'Ask for less: pass a smaller limit, or narrow the list with locale, tag or status.',
    ],
    [
      'publish',
      { publish: async () => ({ ...CANNED.publish.published, entry: SUMMARY_OF_HUGE }) },
      RAN,
    ],
    [
      'unpublish',
      { unpublish: async () => ({ ...CANNED.unpublish.unpublished, entry: SUMMARY_OF_HUGE }) },
      RAN,
    ],
    [
      'update_draft',
      { update_draft: async () => ({ ...CANNED.update_draft.saved, entry: SUMMARY_OF_HUGE }) },
      RAN,
    ],
    [
      'validate',
      {
        validate: async () => ({
          outcome: 'ok',
          verdict: {
            ...CANNED.validate.ok.verdict,
            ok: false,
            errors: [
              {
                contract: 'huge',
                severity: 'error',
                path: '/body',
                message: HUGE,
                fix: 'Shorten it.',
              },
            ],
          },
        }),
      },
      'The verdict lists more problems than fit in one answer. Fix the first ones and validate again.',
    ],
  ]

  it.each(TOO_LARGE)(
    'turns an answer of %s over the cap into an error with its own fix, never a cut',
    async (tool, overrides, fix) => {
      const { endpoint, logs } = endpointWith(overrides)

      const answer = await callRaw(endpoint, 'modern', tool, INPUTS[tool])

      expect(answer.result.isError).toBe(true)
      expect(answer.result).not.toHaveProperty('structuredContent')
      const error = textOf(answer.result)
      expect(error).toEqual({
        code: 'output_too_large',
        message: expect.stringMatching(
          new RegExp(`^The answer of ${tool} is \\d{7} bytes, over the cap of 1048576 bytes\\.$`),
        ),
        fix,
      })
      expect(logs).toHaveLength(1)
    },
  )
})

describe('the time limit', () => {
  it.each([
    ['list_entries', 'read', 'Try again. If it keeps timing out, ask for less.'],
    [
      'update_draft',
      'edit',
      'The change may still be applied after this answer: read the entry with get_entry before you repeat the call.',
    ],
    [
      'create_draft',
      'write',
      'The change may still be applied after this answer: read the entry with get_entry before you repeat the call.',
    ],
    [
      'unpublish',
      'destructive',
      'The change may still be applied after this answer: read the entry with get_entry before you repeat the call.',
    ],
  ] as const)(
    'ends %s, whose effect is %s, as the error timeout with its fix',
    async (tool, _effect, fix) => {
      const stuck: Overrides = { [tool]: NEVER }
      const { endpoint } = endpointWith(stuck, { timeoutMs: 30 })

      const answer = await callRaw(endpoint, 'modern', tool, INPUTS[tool])

      expect(answer.result.isError).toBe(true)
      expect(answer.result.content).toEqual([
        {
          type: 'text',
          text: JSON.stringify({
            code: 'timeout',
            message: `${tool} did not finish within 30 ms.`,
            fix,
          }),
        },
      ])
      expect(answer.result).not.toHaveProperty('structuredContent')
    },
  )

  it('lets through an operation that finishes within it', async () => {
    const slow: Overrides = {
      list_entries: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return CANNED.list_entries.ok
      },
    }
    const { endpoint } = endpointWith(slow, { timeoutMs: 2000 })

    const answer = await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries)

    expect(answer.result.isError).toBe(false)
    expect(answer.result.structuredContent).toEqual(LIST_OUTPUT)
  })

  it('waits for an open-world operation past the limit of the others, up to its own', async () => {
    const slow = async <T>(value: T): Promise<T> => {
      await new Promise((resolve) => setTimeout(resolve, 60))
      return value
    }
    const { endpoint } = endpointWith(
      {
        content_stats: () => slow(CANNED.content_stats.ok),
        list_entries: () => slow(CANNED.list_entries.ok),
      },
      { timeoutMs: 15, openWorldTimeoutMs: 2000 },
    )

    const stats = await callRaw(endpoint, 'modern', 'content_stats', INPUTS.content_stats)
    const list = await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries)

    expect(stats.result.isError).toBe(false)
    expect(stats.result.structuredContent).toEqual(CANNED.content_stats.ok)
    expect(textOf(list.result)).toMatchObject({
      code: 'timeout',
      message: 'list_entries did not finish within 15 ms.',
    })
  })

  it('answers the timeout once, and a late failure of the operation changes nothing', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const failsLate: Overrides = {
        list_entries: async () => {
          await new Promise((resolve) => setTimeout(resolve, 60))
          throw new Error('too late to matter')
        },
      }
      const { endpoint, logs } = endpointWith(failsLate, { timeoutMs: 15 })

      const answer = await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries)
      await new Promise((resolve) => setTimeout(resolve, 120))

      expect(textOf(answer.result)).toMatchObject({ code: 'timeout' })
      expect(unhandled).toEqual([])
      expect(logs).toHaveLength(1)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('calls at the same time', () => {
  it('each see their own principal and request id, and answer their own caller', async () => {
    const gate = Promise.withResolvers<void>()
    let started = 0
    const meeting: Overrides = {
      list_entries: async (_input, context) => {
        started += 1
        if (started === 2) gate.resolve()
        await gate.promise
        return {
          outcome: 'ok',
          entries: [{ ...SUMMARY, slug: context.requestId, tags: [context.principal.kind] }],
          nextCursor: null,
        }
      },
    }
    const { endpoint, seen } = endpointWith(meeting)
    const first = makeCall({ principal: tokenPrincipal(['content:read']), requestId: 'req_first' })
    const second = makeCall({
      principal: { kind: 'binding', scopes: ['content:read'] },
      requestId: 'req_second',
    })

    const [one, two] = await Promise.all([
      callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries, { call: first }),
      callRaw(endpoint, 'legacy', 'list_entries', INPUTS.list_entries, { call: second }),
    ])

    expect(seen.map((call) => call.context.requestId).toSorted()).toEqual([
      'req_first',
      'req_second',
    ])
    expect(textOf(one.result)).toEqual({
      outcome: 'ok',
      entries: [{ ...SUMMARY, slug: 'req_first', tags: ['token'] }],
      nextCursor: null,
    })
    expect(textOf(two.result)).toEqual({
      outcome: 'ok',
      entries: [{ ...SUMMARY, slug: 'req_second', tags: ['binding'] }],
      nextCursor: null,
    })
  })
})
