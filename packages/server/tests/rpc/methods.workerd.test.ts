import { HollwareError } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import type { HollwareRpc } from '../../src/index.ts'
import { createRpc, type RpcLogEntry } from '../../src/rpc/index.ts'
import { failure, onlyCall, SITE, SITE_KEY, testClock, watchDb } from '../http/support.ts'
import { CANNED, ENTRY_ID, fakeHandlers, type Overrides } from '../mcp/support.ts'
import { CALLS } from './support.ts'

// Fails when: the four methods of the RPC surface (`createRpc`, `src/rpc/methods.ts`) stop doing
// what the binding of a site relies on. Each method must check that its site is the one of this
// deployment before anything else (a wrong site is `invalid_input` whose message and fix name the
// site served, and no session is opened for it); build the input of its operation from its
// arguments and parse it with the spec's schema (the defaults `limit` 20 and `formats` ['markdown']
// apply, a bad value or an option that is not one of its own is `invalid_input` naming it, and
// the handler does not run); run only the handler of its own operation, with `view: 'published'`
// and the principal `{ kind: 'binding', scopes: ['content:read'] }`, a store over a D1 session
// that starts at `first-unconstrained` (published content from the nearest replica, never the
// primary), the clock of the Worker, `client: null` and an id of its own for each call; answer
// what the handler answers; and show a caller no cause: a `HollwareError` goes as it is without
// its cause, anything else becomes `internal` with the id of the call, and what is hidden goes to
// the log under that id. D1 is the real one, migrated.

/** The same four calls, each with the wrong site. */
const STRANGER = 'a-stranger-site'
const WRONG_SITE = [
  {
    method: 'getEntry',
    call: (rpc: HollwareRpc) => rpc.getEntry(STRANGER, 'blog', 'hello-world', 'en'),
  },
  { method: 'listEntries', call: (rpc: HollwareRpc) => rpc.listEntries(STRANGER, 'blog') },
  {
    method: 'getTranslations',
    call: (rpc: HollwareRpc) => rpc.getTranslations(STRANGER, 'blog', 'hello'),
  },
  { method: 'describeSite', call: (rpc: HollwareRpc) => rpc.describeSite(STRANGER) },
] as const

/** The RPC surface over fake handlers and the real D1, with what the handlers and D1 saw. */
function rpcOver(overrides: Overrides = {}) {
  const { handlers, seen } = fakeHandlers(overrides)
  const clock = testClock()
  const logs: RpcLogEntry[] = []
  const watched = watchDb(env.DB)
  const rpc = createRpc(
    { sites: new Map([[SITE.key, SITE]]), handlers, clock, log: (entry) => void logs.push(entry) },
    { DB: watched.db },
  )
  return { rpc, seen, clock, logs, ...watched }
}

/** The cause an error carries; a value that is no error has none to give, so it is not undefined. */
function causeOf(error: unknown): unknown {
  return error instanceof Error ? error.cause : 'not an error'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('a call over RPC', () => {
  it.each(CALLS)(
    '$method runs the handler of $tool with the input its spec parses, and answers its output',
    async ({ call, tool, input, output }) => {
      const { rpc, seen } = rpcOver()

      const answer = await call(rpc)

      expect(answer).toEqual(output)
      expect(seen.map((one) => one.tool)).toEqual([tool])
      expect(onlyCall(seen).input).toStrictEqual(input)
    },
  )

  it.each(CALLS)(
    '$method runs it on the published view, as a binding that can only read, with the clock of the Worker',
    async ({ call }) => {
      const { rpc, seen, clock } = rpcOver()

      await call(rpc)

      const { context } = onlyCall(seen)
      expect(context.view).toBe('published')
      expect(context.principal).toEqual({ kind: 'binding', scopes: ['content:read'] })
      expect(context.client).toBeNull()
      expect(context.clock).toBe(clock)
      expect(context.site).toBe(SITE)
      expect(context.requestId).toMatch(UUID)
    },
  )

  it('gives every call an id of its own', async () => {
    const { rpc, seen } = rpcOver()

    await rpc.describeSite(SITE_KEY)
    await rpc.describeSite(SITE_KEY)

    const [first, second] = seen.map((one) => one.context.requestId)
    expect(first).toMatch(UUID)
    expect(second).toMatch(UUID)
    expect(second).not.toBe(first)
  })

  it('reads through a session that may go to the nearest replica, and never the primary', async () => {
    const { rpc, sessions, queries } = rpcOver({
      get_entry: async (_input, context) => {
        await context.store.findEntryById(context.site.key, ENTRY_ID, context.view)
        return CANNED.get_entry.not_found
      },
    })

    await rpc.getEntry(SITE_KEY, 'blog', 'hello-world', 'en')

    expect(sessions).toEqual(['first-unconstrained'])
    expect(queries).toHaveLength(1)
    expect(queries[0]?.via).toBe('session')
    expect(queries[0]?.sql).toContain('from "entries"')
  })
})

describe('the options of a call', () => {
  it('may be null, which is none', async () => {
    const { rpc, seen } = rpcOver()

    await rpc.listEntries(SITE_KEY, 'blog', JSON.parse('null'))

    expect(onlyCall(seen).input).toStrictEqual({ collection: 'blog', limit: 20 })
  })

  it.each(['5', 'true', '"locale"', '["locale"]'])(
    'refuse %s, which is no object',
    async (options) => {
      const { rpc, seen, sessions } = rpcOver()

      const error = await failure(rpc.listEntries(SITE_KEY, 'blog', JSON.parse(options)))

      expect(error).toBeInstanceOf(HollwareError)
      expect(error).toMatchObject({
        code: 'invalid_input',
        message: 'The options of the call are not an object.',
        fix: 'Pass an object with only these options: locale, tag, limit, cursor, or none.',
      })
      expect(seen).toEqual([])
      expect(sessions).toEqual([])
    },
  )

  it('reach getEntry as the formats it asks for, and the default applies when it asks for none', async () => {
    const { rpc, seen } = rpcOver()

    await rpc.getEntry(SITE_KEY, 'blog', 'hello-world', 'es', { formats: ['html', 'document'] })
    await rpc.getEntry(SITE_KEY, 'blog', 'hello-world', 'es', {})
    await rpc.getEntry(SITE_KEY, 'blog', 'hello-world', 'es', { formats: undefined })

    expect(seen.map((one) => one.input)).toStrictEqual([
      {
        collection: 'blog',
        locale: 'es',
        slug: 'hello-world',
        formats: ['html', 'document'],
        published: false,
        related: false,
      },
      {
        collection: 'blog',
        locale: 'es',
        slug: 'hello-world',
        formats: ['markdown'],
        published: false,
        related: false,
      },
      {
        collection: 'blog',
        locale: 'es',
        slug: 'hello-world',
        formats: ['markdown'],
        published: false,
        related: false,
      },
    ])
  })

  it('reach listEntries as the filter, the page size and the cursor, and a key left undefined is not there', async () => {
    const { rpc, seen } = rpcOver()

    await rpc.listEntries(SITE_KEY, 'blog', { locale: 'es', tag: 'cms', limit: 5, cursor: 'c2' })
    await rpc.listEntries(SITE_KEY, 'blog', { locale: undefined, limit: 100 })
    await rpc.listEntries(SITE_KEY, 'blog', {})

    expect(seen.map((one) => one.input)).toStrictEqual([
      { collection: 'blog', locale: 'es', tag: 'cms', limit: 5, cursor: 'c2' },
      { collection: 'blog', limit: 100 },
      { collection: 'blog', limit: 20 },
    ])
  })

  it.each([
    {
      method: 'listEntries',
      unknown: 'status',
      allowed: 'locale, tag, limit, cursor',
      call: (rpc: HollwareRpc) =>
        rpc.listEntries(SITE_KEY, 'blog', JSON.parse('{"status":"draft"}')),
    },
    {
      method: 'listEntries',
      unknown: 'lcoale',
      allowed: 'locale, tag, limit, cursor',
      call: (rpc: HollwareRpc) => rpc.listEntries(SITE_KEY, 'blog', JSON.parse('{"lcoale":"es"}')),
    },
    {
      method: 'listEntries',
      unknown: 'collection',
      allowed: 'locale, tag, limit, cursor',
      call: (rpc: HollwareRpc) =>
        rpc.listEntries(SITE_KEY, 'blog', JSON.parse('{"collection":"talks"}')),
    },
    {
      method: 'getEntry',
      unknown: 'format',
      allowed: 'formats, related, preview',
      call: (rpc: HollwareRpc) =>
        rpc.getEntry(SITE_KEY, 'blog', 'hello-world', 'en', JSON.parse('{"format":["html"]}')),
    },
  ])(
    '$method refuses the option $unknown, which is none of its own',
    async ({ call, unknown, allowed }) => {
      const { rpc, seen, sessions } = rpcOver()

      const error = await failure(call(rpc))

      expect(error).toBeInstanceOf(HollwareError)
      expect(error).toMatchObject({
        code: 'invalid_input',
        message: `The call has options that Hollware does not know: ${unknown}.`,
        fix: `Pass only these options: ${allowed}.`,
      })
      expect(seen).toEqual([])
      expect(sessions).toEqual([])
    },
  )
})

describe('a call that breaks the schema of its operation', () => {
  it.each([
    {
      method: 'getEntry',
      field: 'slug',
      call: (rpc: HollwareRpc) => rpc.getEntry(SITE_KEY, 'blog', 'Not A Slug', 'en'),
    },
    {
      method: 'getEntry',
      field: 'collection',
      call: (rpc: HollwareRpc) => rpc.getEntry(SITE_KEY, '', 'hello-world', 'en'),
    },
    {
      method: 'getEntry',
      field: 'locale',
      call: (rpc: HollwareRpc) => rpc.getEntry(SITE_KEY, 'blog', 'hello-world', ''),
    },
    {
      method: 'getEntry',
      field: 'formats',
      call: (rpc: HollwareRpc) =>
        rpc.getEntry(SITE_KEY, 'blog', 'hello-world', 'en', { formats: [] }),
    },
    {
      method: 'getEntry',
      field: 'formats.0',
      call: (rpc: HollwareRpc) =>
        rpc.getEntry(SITE_KEY, 'blog', 'hello-world', 'en', JSON.parse('{"formats":["pdf"]}')),
    },
    {
      method: 'listEntries',
      field: 'limit',
      call: (rpc: HollwareRpc) => rpc.listEntries(SITE_KEY, 'blog', { limit: 0 }),
    },
    {
      method: 'listEntries',
      field: 'limit',
      call: (rpc: HollwareRpc) => rpc.listEntries(SITE_KEY, 'blog', { limit: 101 }),
    },
    {
      method: 'listEntries',
      field: 'limit',
      call: (rpc: HollwareRpc) => rpc.listEntries(SITE_KEY, 'blog', { limit: 2.5 }),
    },
    {
      method: 'listEntries',
      field: 'limit',
      call: (rpc: HollwareRpc) => rpc.listEntries(SITE_KEY, 'blog', JSON.parse('{"limit":"5"}')),
    },
    {
      method: 'listEntries',
      field: 'cursor',
      call: (rpc: HollwareRpc) => rpc.listEntries(SITE_KEY, 'blog', { cursor: '' }),
    },
    {
      method: 'listEntries',
      field: 'tag',
      call: (rpc: HollwareRpc) => rpc.listEntries(SITE_KEY, 'blog', { tag: '' }),
    },
    {
      method: 'getTranslations',
      field: 'translationGroup',
      call: (rpc: HollwareRpc) => rpc.getTranslations(SITE_KEY, 'blog', ''),
    },
  ])('$method is invalid_input naming $field, and no handler runs', async ({ field, call }) => {
    const { rpc, seen, sessions } = rpcOver()

    const error = await failure(call(rpc))

    expect(error).toBeInstanceOf(HollwareError)
    expect(error).toMatchObject({
      code: 'invalid_input',
      message: expect.stringMatching(
        new RegExp(`^The arguments of the call are not valid\\. ${field.replace('.', '\\.')}: `),
      ),
      fix: 'Fix the arguments named above and call again. describeSite lists the collections and locales of the site.',
    })
    expect(seen).toEqual([])
    expect(sessions).toEqual([])
  })

  it('says what is wrong with a number that is too big, as the schema words it', async () => {
    const { rpc } = rpcOver()

    const error = await failure(rpc.listEntries(SITE_KEY, 'blog', { limit: 101 }))

    expect(error).toMatchObject({
      message:
        'The arguments of the call are not valid. limit: Too big: expected number to be <=100.',
    })
  })
})

describe('a call for another site', () => {
  it.each(WRONG_SITE)(
    '$method is invalid_input that names the sites this deployment serves, and opens no session',
    async ({ call }) => {
      const { rpc, seen, sessions, queries } = rpcOver()

      const error = await failure(call(rpc))

      expect(error).toBeInstanceOf(HollwareError)
      expect(error).toMatchObject({
        code: 'invalid_input',
        message: 'This Hollware serves no site "a-stranger-site": it serves "gateway-tests".',
        fix: 'Pass one of "gateway-tests", the sites this deployment serves, as the site argument.',
      })
      expect(seen).toEqual([])
      expect(sessions).toEqual([])
      expect(queries).toEqual([])
    },
  )

  it('is refused before its arguments are looked at', async () => {
    const { rpc } = rpcOver()

    const error = await failure(rpc.listEntries(STRANGER, '', { limit: 0 }))

    expect(error).toMatchObject({
      code: 'invalid_input',
      fix: expect.stringContaining('"gateway-tests"'),
    })
  })
})

describe('a handler that fails', () => {
  it('is internal for the caller, who gets the id of the call and none of the cause, which goes to the log', async () => {
    const cause = new Error('D1_ERROR: no such table: entries (secret detail)')
    const { rpc, seen, logs } = rpcOver({
      get_entry: async () => {
        throw new Error('the query failed', { cause })
      },
    })

    const error = await failure(rpc.getEntry(SITE_KEY, 'blog', 'hello-world', 'en'))

    const requestId = onlyCall(seen).context.requestId
    expect(error).toBeInstanceOf(HollwareError)
    expect(error).toMatchObject({
      code: 'internal',
      message: 'The operation failed on the server.',
      fix: `Try again. If it keeps failing, give the site operator this request id: ${requestId}.`,
    })
    expect(causeOf(error)).toBeUndefined()
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('secret detail')
    expect(logs).toEqual([
      {
        kind: 'rpc_error',
        requestId,
        method: 'getEntry',
        errorCode: null,
        detail: expect.stringContaining('no such table: entries (secret detail)'),
      },
    ])
  })

  it('is a HollwareError as it was thrown, when a handler throws one, and nothing is logged for it', async () => {
    const { rpc, logs } = rpcOver({
      list_entries: async () => {
        throw new HollwareError(
          'unknown_collection',
          'The site has no collection "talks".',
          'Use one of the collections that describeSite lists: blog.',
        )
      },
    })

    const error = await failure(rpc.listEntries(SITE_KEY, 'talks'))

    expect(error).toBeInstanceOf(HollwareError)
    expect(error).toMatchObject({
      code: 'unknown_collection',
      message: 'The site has no collection "talks".',
      fix: 'Use one of the collections that describeSite lists: blog.',
    })
    expect(logs).toEqual([])
  })

  it('loses the cause of a HollwareError on its way to the caller, and logs it', async () => {
    const { rpc, seen, logs } = rpcOver({
      get_translations: async () => {
        throw new HollwareError('timeout', 'get_translations did not finish.', 'Try again.', {
          cause: new Error('the replica is lagging (secret detail)'),
        })
      },
    })

    const error = await failure(rpc.getTranslations(SITE_KEY, 'blog', 'hello'))

    expect(error).toMatchObject({
      code: 'timeout',
      message: 'get_translations did not finish.',
      fix: 'Try again.',
    })
    expect(causeOf(error)).toBeUndefined()
    expect(logs).toEqual([
      {
        kind: 'rpc_error',
        requestId: onlyCall(seen).context.requestId,
        method: 'getTranslations',
        errorCode: 'timeout',
        detail: expect.stringContaining('the replica is lagging (secret detail)'),
      },
    ])
  })
})
