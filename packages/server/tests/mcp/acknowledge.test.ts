import { describe, expect, it } from 'vite-plus/test'

import {
  askToAcknowledge,
  withAcknowledged,
  type PublishOutput,
} from '../../src/mcp/acknowledge.ts'
import {
  callRaw,
  CANNED,
  cannedOutput,
  connect,
  endpointWith,
  ENTRY_ID,
  INPUTS,
  SUMMARY,
  VERDICT_WARNED,
  WARNING_ALT,
  WARNING_TITLE,
  type ConnectOptions,
  type Overrides,
} from './support.ts'

// Fails when: `publish` stops asking, through a multi round-trip request, a client of the 2026
// era that declared it can show a form; the question stops listing every warning with its fix;
// an acceptance stops publishing with exactly the warnings that were shown, or a refusal
// (decline, cancel, a box left empty) stops answering what was shown without running the handler
// again, or the question is asked twice, or a retry whose state names another entry counts as a
// reply; or a client that cannot be asked (a 2025 client, a 2026
// client without the form capability) stops getting `needs_acknowledgement` and acknowledging
// itself with `acknowledgeWarnings`.

const TITLE = { contract: 'seo-title-length', path: '/frontmatter/title' }
const ALT = { contract: 'image-alt', path: '/body' }

const QUESTION =
  'Publish blog/en/hello-world with 2 warnings?\n\n' +
  '1. seo-title-length at /frontmatter/title: The title has 72 characters. Fix: Shorten it to 60 characters or fewer.\n' +
  '2. image-alt at /body, line 12: An image has no alternative text. Fix: Describe the image between the brackets.'

/** Publishes only once both warnings are acknowledged; until then it asks for them. */
const strict: Overrides = {
  publish: async (input) =>
    input.acknowledgeWarnings.length >= 2
      ? CANNED.publish.published
      : CANNED.publish.needs_acknowledgement,
}

const FORM = { elicitation: { form: {} } }

/** What a client's person answers to a question of the server. */
type Reply = ReturnType<NonNullable<ConnectOptions['elicit']>>

const tick = (): Reply => ({ action: 'accept', content: { acknowledge: true } })

function asker(reply: () => Reply) {
  const questions: string[] = []
  return {
    questions,
    elicit: (message: string) => {
      questions.push(message)
      return reply()
    },
  }
}

describe('a 2026 client that can show a form', () => {
  it('is asked once, with every warning and its fix, and its acceptance publishes with those warnings', async () => {
    const { endpoint, seen, logs } = endpointWith(strict)
    const { questions, elicit } = asker(tick)
    const { client, exchanges } = await connect(endpoint, {
      era: '2026',
      capabilities: FORM,
      elicit,
    })

    const result = await client.callTool({ name: 'publish', arguments: INPUTS.publish })

    expect(result.isError).toBe(false)
    expect(result.structuredContent).toEqual(CANNED.publish.published)
    expect(questions).toEqual([QUESTION])
    expect(seen.map((call) => call.input)).toEqual([
      { id: ENTRY_ID, version: 1, acknowledgeWarnings: [], group: [] },
      { id: ENTRY_ID, version: 1, acknowledgeWarnings: [TITLE, ALT], group: [] },
    ])
    expect(exchanges.map((exchange) => exchange.body?.method)).toEqual([
      'server/discover',
      'tools/call',
      'tools/call',
    ])
    expect(logs.map((entry) => entry.kind === 'call' && [entry.outcome, entry.isError])).toEqual([
      ['needs_acknowledgement', false],
      ['published', false],
    ])
    await client.close()
  })

  it('gets the question as an input-required result that carries what it was shown', async () => {
    const { endpoint } = endpointWith(strict)

    const asked = await callRaw(endpoint, 'modern', 'publish', INPUTS.publish, {
      capabilities: FORM,
    })

    expect(asked.status).toBe(200)
    expect(asked.result).toEqual({
      resultType: 'input_required',
      inputRequests: {
        acknowledge_warnings: {
          method: 'elicitation/create',
          params: {
            mode: 'form',
            message: QUESTION,
            requestedSchema: {
              $schema: 'https://json-schema.org/draft/2020-12/schema',
              type: 'object',
              properties: {
                acknowledge: { type: 'boolean', description: 'Publish with these warnings.' },
              },
              required: ['acknowledge'],
            },
          },
        },
      },
      requestState: JSON.stringify(CANNED.publish.needs_acknowledgement),
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'hollware', version: '0.0.0' } },
    })
  })

  it('takes a retry whose state names another entry as a first call, and runs the handler', async () => {
    const { endpoint, seen } = endpointWith(strict)
    const forged = {
      ...CANNED.publish.needs_acknowledgement,
      entry: {
        ...CANNED.publish.needs_acknowledgement.entry,
        id: 'ent_01JAB3XQ8ZK4M6N2P5R7S9T0ZZ',
      },
    }

    const answered = await callRaw(endpoint, 'modern', 'publish', INPUTS.publish, {
      capabilities: FORM,
      inputResponses: { acknowledge_warnings: { action: 'decline' } },
      requestState: JSON.stringify(forged),
    })

    // Asked again about its own entry, by the handler, never answered with the forged one.
    expect(seen).toHaveLength(1)
    expect(answered.result?.['requestState']).toBe(
      JSON.stringify(CANNED.publish.needs_acknowledgement),
    )
  })

  const REFUSALS: readonly (readonly [string, Reply])[] = [
    ['declines', { action: 'decline' }],
    ['cancels', { action: 'cancel' }],
    ['accepts with the box left empty', { action: 'accept', content: { acknowledge: false } }],
  ]

  it.each(REFUSALS)(
    'that %s is answered what it was shown, without the handler running again, and never asked twice',
    async (_label, reply) => {
      // A handler that would publish on any call after the first: a refusal must not reach it.
      let calls = 0
      const publishesAfterAsking: Overrides = {
        publish: async () =>
          ++calls === 1 ? CANNED.publish.needs_acknowledgement : CANNED.publish.published,
      }
      const { endpoint, seen, logs } = endpointWith(publishesAfterAsking)
      const { questions, elicit } = asker(() => reply)
      const { client, exchanges } = await connect(endpoint, {
        era: '2026',
        capabilities: FORM,
        elicit,
      })

      const result = await client.callTool({ name: 'publish', arguments: INPUTS.publish })

      expect(result.isError).toBe(false)
      expect(result.structuredContent).toEqual(CANNED.publish.needs_acknowledgement)
      expect(questions).toHaveLength(1)
      expect(seen).toHaveLength(1)
      expect(exchanges.map((exchange) => exchange.body?.method)).toEqual([
        'server/discover',
        'tools/call',
        'tools/call',
      ])
      expect(logs.map((entry) => entry.kind === 'call' && [entry.outcome, entry.isError])).toEqual([
        ['needs_acknowledgement', false],
        ['needs_acknowledgement', false],
      ])
      await client.close()
    },
  )

  it('is not asked again when the warnings it accepted are not all there is', async () => {
    const alwaysAsks: Overrides = { publish: async () => CANNED.publish.needs_acknowledgement }
    const { endpoint, seen } = endpointWith(alwaysAsks)
    const { questions, elicit } = asker(tick)
    const { client } = await connect(endpoint, { era: '2026', capabilities: FORM, elicit })

    const result = await client.callTool({ name: 'publish', arguments: INPUTS.publish })

    expect(result.structuredContent).toEqual(CANNED.publish.needs_acknowledgement)
    expect(questions).toHaveLength(1)
    expect(seen).toHaveLength(2)
    await client.close()
  })

  it('adds the warnings it was shown to those it already acknowledged, each once', async () => {
    const { endpoint, seen } = endpointWith(strict)
    const { elicit } = asker(tick)
    const { client } = await connect(endpoint, { era: '2026', capabilities: FORM, elicit })

    const result = await client.callTool({
      name: 'publish',
      arguments: { ...INPUTS.publish, acknowledgeWarnings: [ALT] },
    })

    expect(result.structuredContent).toEqual(CANNED.publish.published)
    expect(seen.map((call) => call.input)).toEqual([
      { id: ENTRY_ID, version: 1, acknowledgeWarnings: [ALT], group: [] },
      { id: ENTRY_ID, version: 1, acknowledgeWarnings: [ALT, TITLE], group: [] },
    ])
    await client.close()
  })

  it.each(['published', 'blocked', 'conflict', 'not_found'])(
    'is not asked when the publish ends in %s: there is nothing to acknowledge',
    async (outcome) => {
      const { endpoint, seen } = endpointWith({}, { outcomes: { publish: outcome } })
      const { questions, elicit } = asker(tick)
      const { client } = await connect(endpoint, { era: '2026', capabilities: FORM, elicit })

      const result = await client.callTool({ name: 'publish', arguments: INPUTS.publish })

      expect(result.structuredContent).toEqual(cannedOutput('publish', outcome))
      expect(questions).toEqual([])
      expect(seen).toHaveLength(1)
      await client.close()
    },
  )

  it('gets needs_acknowledgement as it is when there is no warning to put in a question', async () => {
    const withoutWarnings: PublishOutput = {
      outcome: 'needs_acknowledgement',
      entry: SUMMARY,
      verdict: { ...VERDICT_WARNED, warnings: [] },
    }
    const { endpoint } = endpointWith({ publish: async () => withoutWarnings })
    const { questions, elicit } = asker(tick)
    const { client } = await connect(endpoint, { era: '2026', capabilities: FORM, elicit })

    const result = await client.callTool({ name: 'publish', arguments: INPUTS.publish })

    expect(result.structuredContent).toEqual(withoutWarnings)
    expect(questions).toEqual([])
    await client.close()
  })

  const LOST: readonly (readonly [string, Reply | undefined, string | undefined])[] = [
    ['no reply to a question of ours', undefined, undefined],
    ['a reply without the state it belongs to', tick(), undefined],
    ['a reply with a state that is not JSON', tick(), 'not json'],
    [
      'a reply with a state that is not what we asked',
      tick(),
      JSON.stringify(CANNED.publish.published),
    ],
  ]

  it.each(LOST)('asks as it would the first time for %s', async (_label, reply, state) => {
    const { endpoint, seen } = endpointWith(strict)

    const answer = await callRaw(endpoint, 'modern', 'publish', INPUTS.publish, {
      capabilities: FORM,
      ...(reply === undefined ? {} : { inputResponses: { acknowledge_warnings: reply } }),
      ...(state === undefined ? {} : { requestState: state }),
    })

    expect(answer.result.resultType).toBe('input_required')
    expect(seen.map((call) => call.input)).toEqual([
      { id: ENTRY_ID, version: 1, acknowledgeWarnings: [], group: [] },
    ])
  })
})

describe('a client that cannot be asked', () => {
  it('gets needs_acknowledgement, and acknowledges by itself (2025 client, even one that declares forms)', async () => {
    const { endpoint, seen } = endpointWith(strict)
    const { questions, elicit } = asker(tick)
    const { client } = await connect(endpoint, { era: '2025', capabilities: FORM, elicit })

    const first = await client.callTool({ name: 'publish', arguments: INPUTS.publish })
    const second = await client.callTool({
      name: 'publish',
      arguments: { ...INPUTS.publish, acknowledgeWarnings: [TITLE, ALT] },
    })

    expect(first.isError).toBe(false)
    expect(first.structuredContent).toEqual(CANNED.publish.needs_acknowledgement)
    expect(second.structuredContent).toEqual(CANNED.publish.published)
    expect(questions).toEqual([])
    expect(seen.map((call) => call.input)).toEqual([
      { id: ENTRY_ID, version: 1, acknowledgeWarnings: [], group: [] },
      { id: ENTRY_ID, version: 1, acknowledgeWarnings: [TITLE, ALT], group: [] },
    ])
    await client.close()
  })

  it.each([
    ['declares nothing', undefined],
    ['declares forms of elicitation only for urls', { elicitation: { url: {} } }],
  ] as const)(
    'gets needs_acknowledgement from a 2026 client that %s, and acknowledges by itself',
    async (_label, capabilities) => {
      const { endpoint, seen } = endpointWith(strict)
      const { client } = await connect(endpoint, {
        era: '2026',
        ...(capabilities === undefined ? {} : { capabilities }),
      })

      const first = await client.callTool({ name: 'publish', arguments: INPUTS.publish })
      const second = await client.callTool({
        name: 'publish',
        arguments: { ...INPUTS.publish, acknowledgeWarnings: [TITLE, ALT] },
      })

      expect(first.structuredContent).toEqual(CANNED.publish.needs_acknowledgement)
      expect(second.structuredContent).toEqual(CANNED.publish.published)
      expect(seen).toHaveLength(2)
      await client.close()
    },
  )

  it.each([
    ['a bare elicitation capability, which means forms', { elicitation: {} }],
    ['forms', { elicitation: { form: {} } }],
    ['forms and urls', { elicitation: { form: {}, url: {} } }],
  ] as const)('is asked when the 2026 client declares %s', async (_label, capabilities) => {
    const { endpoint } = endpointWith(strict)
    const { questions, elicit } = asker(tick)
    const { client } = await connect(endpoint, { era: '2026', capabilities, elicit })

    await client.callTool({ name: 'publish', arguments: INPUTS.publish })

    expect(questions).toEqual([QUESTION])
    await client.close()
  })
})

describe('the question', () => {
  const asked = CANNED.publish.needs_acknowledgement

  it('says 1 warning, and names the entry only when it knows it', () => {
    const one = {
      ...asked,
      entry: undefined,
      verdict: { ...VERDICT_WARNED, warnings: [WARNING_TITLE] },
    }

    const question = askToAcknowledge(one)

    expect(question.inputRequests?.acknowledge_warnings).toMatchObject({
      params: {
        message:
          'Publish this entry with 1 warning?\n\n1. seo-title-length at /frontmatter/title: The title has 72 characters. Fix: Shorten it to 60 characters or fewer.',
      },
    })
  })

  it('keeps the answer it asks about as the state, for the retry to find', () => {
    expect(askToAcknowledge(asked).requestState).toBe(JSON.stringify(asked))
  })
})

describe('the acknowledged warnings', () => {
  it('are those the client sent, then those it was shown, each contract and path once', () => {
    const input = { id: ENTRY_ID, version: 4, acknowledgeWarnings: [ALT], group: [] }
    const shown: PublishOutput = {
      outcome: 'needs_acknowledgement',
      entry: SUMMARY,
      verdict: { ...VERDICT_WARNED, warnings: [WARNING_TITLE, WARNING_ALT, WARNING_TITLE] },
    }

    expect(withAcknowledged(input, shown)).toEqual({
      id: ENTRY_ID,
      version: 4,
      acknowledgeWarnings: [ALT, TITLE],
      group: [],
    })
  })

  it('are those the client sent when it was shown no verdict', () => {
    const input = { id: ENTRY_ID, version: 4, acknowledgeWarnings: [ALT], group: [] }

    expect(withAcknowledged(input, { outcome: 'needs_acknowledgement' })).toEqual(input)
  })
})
