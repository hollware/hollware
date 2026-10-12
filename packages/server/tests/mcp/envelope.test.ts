import { describe, expect, it } from 'vite-plus/test'

import { canElicitForm, declaredClient } from '../../src/mcp/envelope.ts'

// Fails when: a client the server may ask a question stops being exactly one of the 2026 era that
// declared the elicitation capability for forms (a bare declaration counts as forms, `url` alone
// does not, and a 2025 client never does); or what a client says about itself stops being its
// name, version and title, each cut short, and nothing else.

const CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities'
const INFO = 'io.modelcontextprotocol/clientInfo'

const declaring = (capabilities: unknown) => ({ [CAPABILITIES]: capabilities })

describe('canElicitForm', () => {
  it.each([
    [true, 'forms', { elicitation: { form: {} } }],
    [true, 'a bare elicitation, which means forms', { elicitation: {} }],
    [true, 'forms and urls', { elicitation: { form: {}, url: {} } }],
    [false, 'urls only', { elicitation: { url: {} } }],
    [false, 'no elicitation', { sampling: {} }],
    [false, 'nothing', {}],
    [false, 'an elicitation that is not an object', { elicitation: true }],
    [false, 'capabilities that are not an object', 'elicitation'],
  ])('is %s for a 2026 client that declares %s', (expected, _label, capabilities) => {
    expect(canElicitForm('modern', declaring(capabilities))).toBe(expected)
  })

  it('is never so in the 2025 era, whatever the client declares', () => {
    expect(canElicitForm('legacy', declaring({ elicitation: { form: {} } }))).toBe(false)
  })

  it.each([undefined, null, 'envelope', {}, { [INFO]: { name: 'x' } }])(
    'is not so for a request without capabilities in its envelope: %j',
    (envelope) => {
      expect(canElicitForm('modern', envelope)).toBe(false)
    },
  )
})

describe('declaredClient', () => {
  it('is the name, version and title of the client, and nothing else it says', () => {
    const envelope = {
      [INFO]: {
        name: 'claude-code',
        version: '2.1.0',
        title: 'Claude Code',
        description: 'An agent',
        websiteUrl: 'https://example.com',
      },
    }

    expect(declaredClient(envelope)).toEqual({
      name: 'claude-code',
      version: '2.1.0',
      title: 'Claude Code',
    })
  })

  it('is the name alone when the client gives no more', () => {
    expect(declaredClient({ [INFO]: { name: 'script' } })).toEqual({ name: 'script' })
  })

  it('cuts each of the three at 120 characters', () => {
    const long = 'x'.repeat(121)

    expect(declaredClient({ [INFO]: { name: long, version: long, title: long } })).toEqual({
      name: 'x'.repeat(120),
      version: 'x'.repeat(120),
      title: 'x'.repeat(120),
    })
  })

  it.each([
    ['no envelope', undefined],
    ['an envelope without the client', {}],
    ['a client without a name', { [INFO]: { version: '1' } }],
    ['a name that is not text', { [INFO]: { name: 7 } }],
    ['a client that is not an object', { [INFO]: 'claude' }],
    ['an envelope that is not an object', 'claude'],
  ])('is nothing for %s', (_label, envelope) => {
    expect(declaredClient(envelope)).toBeNull()
  })

  it('leaves out a version or a title that is not text', () => {
    expect(declaredClient({ [INFO]: { name: 'x', version: 2, title: ['t'] } })).toEqual({
      name: 'x',
    })
  })
})
