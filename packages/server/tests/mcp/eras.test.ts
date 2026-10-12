import { describe, expect, it } from 'vite-plus/test'

import { connect, endpointWith, INPUTS } from './support.ts'

// Fails when: the endpoint stops serving a 2026-07-28 client, which discovers and sends the
// envelope in every request, or a 2025-11-25 client, which initializes and then lists and calls,
// from the same endpoint; or either starts needing a session: nothing is kept between requests,
// so no answer may carry a session id.

const methods = (exchanges: { body: { method?: string } | null; method: string }[]) =>
  exchanges.map((exchange) => exchange.body?.method ?? exchange.method)

describe('the two protocol eras', () => {
  it('are served by the same endpoint, side by side, each in its own way', async () => {
    const { endpoint, seen } = endpointWith()
    const modern = await connect(endpoint, { era: '2026' })
    const legacy = await connect(endpoint, { era: '2025' })

    await modern.client.listTools()
    await legacy.client.listTools()
    const fromModern = await modern.client.callTool({
      name: 'list_entries',
      arguments: INPUTS.list_entries,
    })
    const fromLegacy = await legacy.client.callTool({
      name: 'list_entries',
      arguments: INPUTS.list_entries,
    })

    expect(modern.client.getProtocolEra()).toBe('modern')
    expect(legacy.client.getProtocolEra()).toBe('legacy')
    expect(methods(modern.exchanges)).toEqual(['server/discover', 'tools/list', 'tools/call'])
    expect(methods(legacy.exchanges)).toEqual([
      'initialize',
      'notifications/initialized',
      'GET',
      'tools/list',
      'tools/call',
    ])
    expect(modern.exchanges.map((exchange) => exchange.status)).toEqual([200, 200, 200])
    // The 2025 client's own request for a stream is refused: nothing is kept to send on it.
    expect(legacy.exchanges.map((exchange) => exchange.status)).toEqual([200, 202, 405, 200, 200])
    expect(fromModern.structuredContent).toEqual(fromLegacy.structuredContent)
    expect(seen.map((call) => call.context.client)).toEqual([
      { name: 'probe', version: '9.9.9' },
      null,
    ])
    await modern.client.close()
    await legacy.client.close()
  })

  it('never hand out a session, to either', async () => {
    const { endpoint } = endpointWith()
    const modern = await connect(endpoint, { era: '2026' })
    const legacy = await connect(endpoint, { era: '2025' })
    await modern.client.callTool({ name: 'list_entries', arguments: INPUTS.list_entries })
    await legacy.client.callTool({ name: 'list_entries', arguments: INPUTS.list_entries })

    const answers = [...modern.exchanges, ...legacy.exchanges]

    expect(answers.map((exchange) => exchange.headers['mcp-session-id'])).toEqual(
      answers.map(() => undefined),
    )
    expect(modern.exchanges.map((exchange) => exchange.headers['content-type'])).toEqual([
      'application/json',
      'application/json',
    ])
    expect(
      legacy.exchanges
        .filter((exchange) => exchange.method === 'POST' && exchange.status === 200)
        .map((exchange) => exchange.headers['content-type']),
    ).toEqual(['text/event-stream', 'text/event-stream'])
    await modern.client.close()
    await legacy.client.close()
  })
})
