import { describe, expect, it } from 'vite-plus/test'

import type { ConfigProblem } from '../../src/config/config-error.ts'
import { resolveConfig } from '../../src/config/resolve.ts'
import { compileSites } from '../../src/structure/compile.ts'
import { configWith, problemsOf, siteOf, siteWith } from './support.ts'

const MEMBER = 'usr_01J9ZQ3X5V7K2M4N6P8R0T1W3Y'
const SCOPE_FIX =
  'An agent is an author: ask only for "content:read", "content:write", "review:read", "review:comment".'

function agentWith(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'reviewer',
    member: MEMBER,
    events: ['review.requested'],
    delivery: { kind: 'binding', binding: 'AGENTS' },
    ...overrides,
  }
}

interface Case {
  readonly name: string
  readonly agents: unknown
  readonly problems: readonly ConfigProblem[]
}

const cases: readonly Case[] = [
  {
    name: 'two agents of one name',
    agents: [agentWith(), agentWith()],
    problems: [
      {
        path: 'sites.demo.agents[1]',
        message: 'repeats the name "reviewer"',
        fix: 'Give each agent a name of its own.',
      },
    ],
  },
  {
    name: 'a scope beyond those of an author',
    agents: [agentWith({ scopes: ['review:comment', 'content:publish'] })],
    problems: [
      {
        path: 'sites.demo.agents[0].scopes[1]',
        message: 'is "content:publish", which an agent may not have',
        fix: SCOPE_FIX,
      },
    ],
  },
  {
    name: 'schema:admin asked for',
    agents: [agentWith({ scopes: ['schema:admin'] })],
    problems: [
      {
        path: 'sites.demo.agents[0].scopes[0]',
        message: 'is "schema:admin", which an agent may not have',
        fix: SCOPE_FIX,
      },
    ],
  },
  {
    name: 'a webhook over plain http to another host',
    agents: [agentWith({ delivery: { kind: 'webhook', url: 'http://agents.example.com/in' } })],
    problems: [
      {
        path: 'sites.demo.agents[0].delivery.url',
        message: 'is "http://agents.example.com/in"; it must be an https URL',
        fix: 'Give the https URL that receives the events; http only for localhost.',
      },
    ],
  },
  {
    name: 'a binding of Hollware itself',
    agents: [agentWith({ delivery: { kind: 'binding', binding: 'DB' } })],
    problems: [
      {
        path: 'sites.demo.agents[0].delivery.binding',
        message: 'is "DB"; it must be the name of a service binding of your own',
        fix: 'Name the service binding of the Worker that runs the agent, such as "AGENTS".',
      },
    ],
  },
  {
    name: 'a member that is no user id, and an event no agent hears',
    agents: [agentWith({ member: 'reviewer', events: ['entry.deleted'] })],
    problems: [
      {
        path: 'sites.demo.agents[0].member',
        message: 'is "reviewer"; it must be the id of an agent member',
        fix: 'Make an agent member in the admin (Agents) or with `hollware agent add`, and give its id (usr_…).',
      },
      {
        path: 'sites.demo.agents[0].events[0]',
        message: 'is "entry.deleted"; it must be an event an agent hears',
        fix: 'Use one of "review.requested", "review.decided", "entry.published", "entry.unpublished", "site.changed".',
      },
    ],
  },
]

describe('the agents of a site', () => {
  it.each(cases)('reports $name', ({ agents, problems }) => {
    expect(problemsOf(configWith({ agents }))).toEqual(problems)
  })

  it('resolves an agent with the default scopes, and a webhook on localhost over http', () => {
    const site = siteOf(
      resolveConfig(
        configWith({
          agents: [
            agentWith({ required: true }),
            agentWith({
              name: 'local',
              delivery: { kind: 'webhook', url: 'http://localhost:8787/in' },
              scopes: ['content:read', 'content:write'],
            }),
          ],
          review: { requireAgents: true },
        }),
      ),
      'demo',
    )

    expect([site.agents, site.review]).toEqual([
      [
        {
          name: 'reviewer',
          member: MEMBER,
          events: ['review.requested'],
          delivery: { kind: 'binding', binding: 'AGENTS' },
          scopes: ['content:read', 'review:read', 'review:comment'],
          required: true,
        },
        {
          name: 'local',
          member: MEMBER,
          events: ['review.requested'],
          delivery: { kind: 'webhook', url: 'http://localhost:8787/in', secret: null },
          scopes: ['content:read', 'content:write'],
          required: false,
        },
      ],
      { requireAgents: true },
    ])
  })

  it('compiles a definition of D1 with agents, and none by default', () => {
    const compiled = compileSites({
      demo: {
        ...siteWith({ collections: {} }),
        collections: {
          blog: {
            schema: { type: 'object' },
            routes: { es: '/blog/:slug/', en: '/en/blog/:slug/' },
          },
        },
        agents: [agentWith()],
      },
      bare: {
        ...siteWith(),
        collections: {
          blog: {
            schema: { type: 'object' },
            routes: { es: '/blog/:slug/', en: '/en/blog/:slug/' },
          },
        },
      },
    })

    expect(compiled.sites.get('demo')?.agents.map((agent) => agent.name)).toEqual(['reviewer'])
    expect([compiled.sites.get('bare')?.agents, compiled.sites.get('bare')?.review]).toEqual([
      [],
      { requireAgents: false },
    ])
  })
})
