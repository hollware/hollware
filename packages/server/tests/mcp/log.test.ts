import { HollwareError } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { createMcpEndpoint } from '../../src/mcp/index.ts'
import {
  callRaw,
  CANNED,
  endpointWith,
  fakeHandlers,
  INPUTS,
  makeCall,
  rpc,
  SUMMARY,
  tokenPrincipal,
  type Overrides,
} from './support.ts'

// Fails when: a call stops writing exactly one line, with its request id, the tool, the outcome or
// the error code, `isError` and the time it took in milliseconds; a refused call (scope) or an
// answer replaced by an error stops being told as what it was; a line carries the input of the
// call or a token; the cause of an error stops going to the log, or reaches the caller; a logger
// that throws fails a call; a request the SDK refuses stops being reported; or the default stops
// being no log at all.

const NEVER = () => new Promise<never>(() => {})
const duration = expect.any(Number)

describe('the log', () => {
  it('has one line for each kind of call, with what happened and never what was asked', async () => {
    const huge = 'x'.repeat(1_100_000)
    const mixed: Overrides = {
      create_draft: async () => ({
        ...CANNED.create_draft.saved,
        entry: { ...SUMMARY, frontmatter: { title: huge } },
      }),
      describe_site: NEVER,
      get_entry: async () => {
        throw new HollwareError('unknown_locale', 'The site has no locale "fr".', 'Use en or es.', {
          cause: new Error('looked up the locales of playground'),
        })
      },
      unpublish: async () => {
        throw new Error('D1_ERROR: no such table: entries')
      },
    }
    const { endpoint, logs } = endpointWith(mixed, {
      timeoutMs: 25,
      outcomes: { update_draft: 'conflict' },
    })
    const reader = tokenPrincipal(['content:read'])
    const as = (requestId: string, principal = tokenPrincipal()) =>
      ({ call: makeCall({ principal, requestId }) }) as const

    await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries, as('req_ok'))
    await callRaw(endpoint, 'modern', 'update_draft', INPUTS.update_draft, as('req_conflict'))
    await callRaw(endpoint, 'legacy', 'get_entry', INPUTS.get_entry, as('req_hollware'))
    await callRaw(endpoint, 'modern', 'unpublish', INPUTS.unpublish, as('req_internal'))
    await callRaw(endpoint, 'modern', 'describe_site', INPUTS.describe_site, as('req_timeout'))
    await callRaw(endpoint, 'modern', 'create_draft', INPUTS.create_draft, as('req_large'))
    await callRaw(endpoint, 'modern', 'create_draft', INPUTS.create_draft, as('req_denied', reader))

    expect(logs).toEqual([
      {
        kind: 'call',
        requestId: 'req_ok',
        tool: 'list_entries',
        outcome: 'ok',
        errorCode: null,
        isError: false,
        durationMs: duration,
        detail: null,
      },
      {
        kind: 'call',
        requestId: 'req_conflict',
        tool: 'update_draft',
        outcome: 'conflict',
        errorCode: null,
        isError: true,
        durationMs: duration,
        detail: null,
      },
      {
        kind: 'call',
        requestId: 'req_hollware',
        tool: 'get_entry',
        outcome: null,
        errorCode: 'unknown_locale',
        isError: true,
        durationMs: duration,
        detail: expect.stringContaining('looked up the locales of playground'),
      },
      {
        kind: 'call',
        requestId: 'req_internal',
        tool: 'unpublish',
        outcome: null,
        errorCode: 'internal',
        isError: true,
        durationMs: duration,
        detail: expect.stringContaining('D1_ERROR: no such table: entries'),
      },
      {
        kind: 'call',
        requestId: 'req_timeout',
        tool: 'describe_site',
        outcome: null,
        errorCode: 'timeout',
        isError: true,
        durationMs: duration,
        detail: null,
      },
      {
        kind: 'call',
        requestId: 'req_large',
        tool: 'create_draft',
        outcome: 'saved',
        errorCode: 'output_too_large',
        isError: true,
        durationMs: duration,
        detail: null,
      },
      {
        kind: 'call',
        requestId: 'req_denied',
        tool: 'create_draft',
        outcome: null,
        errorCode: 'insufficient_scope',
        isError: true,
        durationMs: 0,
        detail: null,
      },
    ])
  })

  it('says how many milliseconds the operation took', async () => {
    const slow: Overrides = {
      list_entries: async () => {
        await new Promise((resolve) => setTimeout(resolve, 45))
        return CANNED.list_entries.ok
      },
    }
    const { endpoint, logs } = endpointWith(slow)

    await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries)

    const [line] = logs
    expect(line?.kind === 'call' && line.durationMs).toBeGreaterThanOrEqual(40)
    expect(line?.kind === 'call' && line.durationMs).toBeLessThan(10_000)
  })

  it('never holds the input of a call or a token, in the log or in what the caller gets', async () => {
    const MARKER = 'MARKDOWN-THAT-MUST-STAY-OUT-OF-THE-LOG'
    const TOKEN = 'hw_pat_0123456789abcdefghjkmnpqrstvwxyz0123456789abcdefghjk'
    const mixed: Overrides = {
      validate: async () => {
        throw new Error('the validator broke')
      },
      unpublish: NEVER,
    }
    const { endpoint, logs } = endpointWith(mixed, { timeoutMs: 25 })
    const headers = { authorization: `Bearer ${TOKEN}` }
    const markdown = `---\ntitle: ${MARKER}\n---\n${MARKER}`
    const calls = [
      callRaw(
        endpoint,
        'modern',
        'create_draft',
        { ...INPUTS.create_draft, markdown },
        { headers },
      ),
      callRaw(endpoint, 'legacy', 'validate', { ...INPUTS.validate, markdown }, { headers }),
      callRaw(endpoint, 'modern', 'unpublish', INPUTS.unpublish, { headers }),
      callRaw(
        endpoint,
        'modern',
        'create_draft',
        { ...INPUTS.create_draft, markdown },
        {
          headers,
          call: makeCall({ principal: tokenPrincipal(['content:read']) }),
        },
      ),
    ]

    const answers = await Promise.all(calls)

    expect(logs).toHaveLength(4)
    for (const text of [JSON.stringify(logs), ...answers.map((answer) => answer.text)]) {
      expect(text).not.toContain(MARKER)
      expect(text).not.toContain(TOKEN)
    }
  })

  it('keeps going when the logger throws', async () => {
    const { handlers } = fakeHandlers({ unpublish: async () => CANNED.unpublish.not_found })
    const endpoint = createMcpEndpoint({
      handlers,
      serverInfo: { name: 'hollware', version: '0.0.0' },
      log: () => {
        throw new Error('the logger is down')
      },
    })
    const reader = makeCall({ principal: tokenPrincipal(['content:read']) })

    const answered = await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries)
    const refused = await callRaw(endpoint, 'modern', 'create_draft', INPUTS.create_draft, {
      call: reader,
    })
    const rejected = await rpc(
      endpoint,
      'modern',
      'tools/list',
      {},
      { headers: { 'content-type': 'text/plain' } },
    )

    expect([answered.status, refused.status, rejected.status]).toEqual([200, 403, 415])
    expect(answered.result.structuredContent).toEqual(CANNED.list_entries.ok)
  })

  it('is nothing at all by default', async () => {
    const { handlers } = fakeHandlers({
      get_entry: async () => {
        throw new Error('no one hears this')
      },
    })
    const endpoint = createMcpEndpoint({
      handlers,
      serverInfo: { name: 'hollware', version: '0.0.0' },
    })

    const ok = await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries)
    const failed = await callRaw(endpoint, 'modern', 'get_entry', INPUTS.get_entry)
    const refused = await callRaw(endpoint, 'modern', 'create_draft', INPUTS.create_draft, {
      call: makeCall({ principal: tokenPrincipal([]) }),
    })

    expect([ok.status, failed.result.isError, refused.status]).toEqual([200, true, 403])
  })

  it('also tells what the SDK refuses before a call is made', async () => {
    const { endpoint, logs } = endpointWith()

    const wrongType = await rpc(
      endpoint,
      'modern',
      'tools/list',
      {},
      {
        headers: { 'content-type': 'text/plain' },
      },
    )
    const wrongName = await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries, {
      headers: { 'mcp-name': 'get_entry' },
    })

    expect([wrongType.status, wrongName.status]).toEqual([415, 400])
    expect(logs).toEqual([
      {
        kind: 'protocol_error',
        message: 'Unsupported Media Type: Content-Type must be application/json',
      },
      {
        kind: 'protocol_error',
        message: expect.stringContaining('the request headers and body disagree'),
      },
    ])
  })
})
