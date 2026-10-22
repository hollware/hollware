import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { createMcpEndpoint } from '../../src/mcp/index.ts'
import { callRaw, CANNED, endpointWith, fakeHandlers, INPUTS, textOf } from './support.ts'

// Fails when: an endpoint is built with a time limit that is not a positive number of
// milliseconds, the default limit stops being the 10 seconds of the plan (`limits.ts`), or an
// open-world operation stops getting its 30 seconds (ADR-040).

afterEach(() => {
  vi.useRealTimers()
})

describe('createMcpEndpoint', () => {
  const { handlers } = fakeHandlers()
  const serverInfo = { name: 'hollware', version: '0.0.0' }

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s as a time limit',
    (timeoutMs) => {
      expect(() => createMcpEndpoint({ handlers, serverInfo, timeoutMs })).toThrow(
        new RangeError(`timeoutMs must be a positive number of milliseconds, got ${timeoutMs}`),
      )
    },
  )

  it.each([0, Number.NaN])('refuses %s as the time limit of open-world operations', (value) => {
    expect(() => createMcpEndpoint({ handlers, serverInfo, openWorldTimeoutMs: value })).toThrow(
      new RangeError(`openWorldTimeoutMs must be a positive number of milliseconds, got ${value}`),
    )
  })

  it('accepts any positive number of milliseconds', () => {
    expect(() => createMcpEndpoint({ handlers, serverInfo, timeoutMs: 1 })).not.toThrow()
  })

  it('gives an operation ten seconds by default, not a millisecond less', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { endpoint } = endpointWith({ create_draft: () => new Promise<never>(() => {}) })
    let settled = false

    const call = callRaw(endpoint, 'modern', 'create_draft', INPUTS.create_draft)
    void call.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(9_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const answer = await call

    expect(answer.result.isError).toBe(true)
    expect(textOf(answer.result)).toMatchObject({
      code: 'timeout',
      message: 'create_draft did not finish within 10000 ms.',
    })
  })

  it('gives an open-world operation thirty seconds by default, not a millisecond less', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { endpoint } = endpointWith({ content_stats: () => new Promise<never>(() => {}) })
    let settled = false

    const call = callRaw(endpoint, 'modern', 'content_stats', INPUTS.content_stats)
    void call.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(29_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const answer = await call

    expect(textOf(answer.result)).toMatchObject({
      code: 'timeout',
      message: 'content_stats did not finish within 30000 ms.',
    })
  })

  it('serves what the handlers answer', async () => {
    const { endpoint } = endpointWith()

    const answer = await callRaw(endpoint, 'modern', 'list_entries', INPUTS.list_entries)

    expect(answer.result.structuredContent).toEqual(CANNED.list_entries.ok)
  })
})
