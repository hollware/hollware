import { describe, expect, it } from 'vite-plus/test'

import {
  firstSteps,
  markStepsDone,
  stepsMarkedDone,
  type StepsStorage,
} from '../app/lib/first-steps.ts'

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

describe('the first steps marked as done', () => {
  const memory = (): StepsStorage & { entries: Record<string, string> } => {
    const entries: Record<string, string> = {}
    return {
      entries,
      getItem: (key) => entries[key] ?? null,
      setItem: (key, value) => {
        entries[key] = value
      },
    }
  }

  it('stays done for the site marked, and only for it', () => {
    const storage = memory()
    expect(stepsMarkedDone(storage, 'blog')).toBe(false)
    markStepsDone(storage, 'blog')
    expect(storage.entries).toEqual({ 'hollware:first-steps-done:blog': 'true' })
    expect(stepsMarkedDone(storage, 'blog')).toBe(true)
    expect(stepsMarkedDone(storage, 'docs')).toBe(false)
  })

  it('shows the steps when the browser keeps nothing', () => {
    const throwing: StepsStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
    }
    expect(() => markStepsDone(throwing, 'blog')).not.toThrow()
    expect(stepsMarkedDone(throwing, 'blog')).toBe(false)
    expect(stepsMarkedDone(undefined, 'blog')).toBe(false)
  })
})
