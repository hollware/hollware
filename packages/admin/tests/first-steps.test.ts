import { describe, expect, it } from 'vite-plus/test'

import { firstSteps } from '../app/lib/first-steps.ts'

const NOW = '2026-10-28T12:00:00.000Z'
const START = { tokens: [], people: 1, entries: 0, analytics: false, now: NOW }

const done = (input: Partial<Parameters<typeof firstSteps>[0]>) =>
  firstSteps({ ...START, ...input }).map((step) => [step.key, step.done])

describe('the first steps of a site', () => {
  it('starts with every step to do, in order, each with the page that does it', () => {
    expect(firstSteps(START)).toEqual([
      { key: 'agent', to: '/settings/tokens', done: false },
      { key: 'entry', to: '/entries/new', done: false },
      { key: 'invite', to: '/settings/people', done: false },
      { key: 'analytics', to: '/settings/site/analytics', done: false },
    ])
  })

  it('counts an agent connected only for a personal token that is neither revoked nor expired', () => {
    const token = { kind: 'personal', revokedAt: null, expiresAt: null }
    expect(done({ tokens: [token] })[0]).toEqual(['agent', true])
    expect(done({ tokens: [{ ...token, expiresAt: '2026-11-01T00:00:00.000Z' }] })[0]).toEqual([
      'agent',
      true,
    ])
    expect(
      done({
        tokens: [
          { ...token, revokedAt: '2026-10-20T00:00:00.000Z' },
          { ...token, expiresAt: '2026-10-28T11:59:59.000Z' },
          { ...token, kind: 'read' },
        ],
      })[0],
    ).toEqual(['agent', false])
  })

  it('counts the entry, the person invited and the analytics', () => {
    expect(done({ entries: 1, people: 2, analytics: true }).slice(1)).toEqual([
      ['entry', true],
      ['invite', true],
      ['analytics', true],
    ])
  })
})
