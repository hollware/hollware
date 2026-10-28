import { FORMER_PERSON } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import {
  activityQuery,
  parseRetention,
  targetLabel,
  whoOf,
  type ActivityLine,
} from '../app/lib/activity.ts'

function line(actor: Partial<ActivityLine['actor']>): ActivityLine {
  return {
    id: 'aud_01',
    at: '2026-10-17T10:00:00.000Z',
    action: 'publish',
    outcome: 'ok',
    errorCode: null,
    actor: {
      kind: 'user',
      userId: null,
      name: null,
      tokenId: null,
      tokenLabel: null,
      clientId: null,
      declared: null,
      ...actor,
    },
    target: null,
    detail: null,
    requestId: null,
    ipHash: null,
  }
}

describe('the query of the activity log', () => {
  it('is empty with no filters', () => {
    expect(activityQuery({})).toBe('')
  })

  it('turns the first day into its start in UTC and the last day into the start of the next', () => {
    expect(activityQuery({ from: '2026-10-01', to: '2026-10-17' })).toBe(
      'from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-18T00%3A00%3A00.000Z',
    )
  })

  it('rolls the end over a month and a year', () => {
    expect(activityQuery({ to: '2026-12-31' })).toBe('to=2027-01-01T00%3A00%3A00.000Z')
    expect(activityQuery({ to: '2028-02-28' })).toBe('to=2028-02-29T00%3A00%3A00.000Z')
  })

  it('leaves out a date that is no day, and a filter left empty', () => {
    expect(activityQuery({ from: 'soon', to: '', actor: '', action: '' })).toBe('')
  })

  it('carries the actor, the action, the limit and the cursor', () => {
    expect(
      activityQuery({ actor: 'usr_1', action: 'token.create' }, { limit: 50, cursor: 'abc' }),
    ).toBe('actor=usr_1&action=token.create&limit=50&cursor=abc')
    expect(activityQuery({}, { cursor: null })).toBe('')
  })
})

const FORMER = 'A former member'

describe('who a line names', () => {
  it('is the former member, whatever it acted through, once its owner anonymized them', () => {
    expect(
      [
        line({ kind: 'user', userId: FORMER_PERSON, name: 'Former member' }),
        line({ kind: 'token', userId: FORMER_PERSON }),
      ].map((anonymized) => whoOf(anonymized, FORMER)),
    ).toEqual([
      { kind: 'user', name: 'A former member', via: null },
      { kind: 'token', name: 'A former member', via: null },
    ])
  })

  it('is the name of the person, else their id', () => {
    expect(whoOf(line({ kind: 'user', userId: 'usr_1', name: 'Olga' }), FORMER)).toEqual({
      kind: 'user',
      name: 'Olga',
      via: null,
    })
    expect(whoOf(line({ kind: 'user', userId: 'usr_1' }), FORMER).name).toBe('usr_1')
  })

  it('is the label of the token, else its id, and what the client declared as via', () => {
    expect(
      whoOf(
        line({
          kind: 'token',
          userId: 'usr_1',
          name: 'Olga',
          tokenId: 'tok_1',
          tokenLabel: 'agent',
          declared: { name: 'Claude Code', model: 'x' },
        }),
        FORMER,
      ),
    ).toEqual({ kind: 'token', name: 'agent', via: 'Claude Code' })
    expect(whoOf(line({ kind: 'token', tokenId: 'tok_1' }), FORMER).name).toBe('tok_1')
  })

  it('is the id of the app, and no name for the deployment', () => {
    expect(whoOf(line({ kind: 'oauth_client', clientId: 'client-9' }), FORMER)).toEqual({
      kind: 'oauth_client',
      name: 'client-9',
      via: null,
    })
    expect(whoOf(line({ kind: 'system' }), FORMER)).toEqual({
      kind: 'system',
      name: null,
      via: null,
    })
  })

  it('ignores a declared name that is no text', () => {
    expect(
      whoOf(line({ kind: 'token', tokenLabel: 'a', declared: { name: 3 } }), FORMER).via,
    ).toBeNull()
    expect(
      whoOf(line({ kind: 'token', tokenLabel: 'a', declared: { name: '' } }), FORMER).via,
    ).toBeNull()
  })
})

describe('the target of a line', () => {
  it('is a dash for none, its type and its id as they are when short', () => {
    expect(targetLabel(null)).toBe('—')
    expect(targetLabel({ type: 'site', id: 'blog' })).toBe('site · blog')
  })

  it('keeps the last eight characters of a long id', () => {
    expect(targetLabel({ type: 'token', id: 'tok_01J8ZQ4K5M6N7P8Q9R0S1T2V3W' })).toBe(
      'token · …0S1T2V3W',
    )
  })
})

describe('the retention of the activity log', () => {
  it('is no limit when kept forever, whatever the days say', () => {
    expect(parseRetention(true, 5)).toEqual({ ok: true, days: null })
  })

  it('takes whole days from 30 to 3650, as a number or as the text of a field', () => {
    expect(parseRetention(false, 30)).toEqual({ ok: true, days: 30 })
    expect(parseRetention(false, '3650')).toEqual({ ok: true, days: 3650 })
  })

  it('refuses fewer, more, fractions, and nothing', () => {
    for (const days of [29, 3651, 45.5, 0, -30, undefined, null, '', ' ', 'many']) {
      expect(parseRetention(false, days)).toEqual({ ok: false, min: 30, max: 3650 })
    }
  })
})
