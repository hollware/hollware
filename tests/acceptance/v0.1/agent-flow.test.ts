import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { connectAgent, type Agent, type Era, type Reply } from './support/agent.ts'
import { createProject, setUpProject, type Project } from './support/project.ts'

let project: Project
let url: string
let token: string

beforeAll(async () => {
  project = createProject()
  token = await setUpProject(project)
  url = await project.start()
})

afterAll(async () => {
  await project.close()
})

const LONG_TITLE = 'Agents that write against contracts, and the people who still review them'
const LONG_DESCRIPTION = 'An agent writes, the contracts check, and a person reviews. '
  .repeat(3)
  .trim()
const DESCRIPTION = 'How an agent writes a post against the contracts of a site.'

function post(group: string, description: string): string {
  return `---
title: ${LONG_TITLE}
description: ${description}
date: 2026-10-13
tags:
  - agents
translationGroup: ${group}
---

# Agents that write

An agent reads describe_site, writes a draft and fixes what the verdict says.
`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${what} is not an object: ${JSON.stringify(value)}`)
  return value
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${what} is not a list: ${JSON.stringify(value)}`)
  return value
}

function problems(verdict: unknown, kind: 'errors' | 'warnings') {
  return list(record(verdict, 'the verdict')[kind], kind).map((item) => {
    const problem = record(item, 'a problem')
    return { contract: problem['contract'], path: problem['path'], severity: problem['severity'] }
  })
}

function fixesOf(verdict: unknown): unknown[] {
  const { errors, warnings } = record(verdict, 'the verdict')
  return [...list(errors, 'errors'), ...list(warnings, 'warnings')].map((item) => {
    const problem = record(item, 'a problem')
    return typeof problem['fix'] === 'string' &&
      problem['fix'].trim() !== '' &&
      problem['fix'] !== problem['message']
      ? 'a fix'
      : problem['fix']
  })
}

const WARNINGS = [
  { contract: 'translation-pair', path: '/frontmatter/translationGroup', severity: 'warning' },
  { contract: 'seo-title-length', path: '/frontmatter/title', severity: 'warning' },
]
const ACKNOWLEDGED = WARNINGS.map(({ contract, path }) => ({ contract, path }))

async function writeAsAnAgent(agent: Agent, slug: string, group: string) {
  const described = await agent.call('describe_site', {})
  expect(described.isError).toBe(false)
  const site = record(described.output['site'], 'the site')
  expect([site['key'], site['locales'], site['styleGuide']]).toEqual([
    'playground',
    ['es', 'en'],
    'Spanish for Latin America, with tú, and plain international English.',
  ])
  const [blog] = list(site['collections'], 'the collections').map((item) =>
    record(item, 'a collection'),
  )
  expect(blog?.['styleGuide']).toBe(
    'Short paragraphs, one idea per section, and an example for every claim.',
  )
  const schema = record(blog?.['schema'], 'the schema')
  expect(record(schema['properties'], 'the properties')['description']).toEqual({
    type: 'string',
    minLength: 1,
    maxLength: 160,
  })

  const created = await agent.call('create_draft', {
    collection: 'blog',
    locale: 'en',
    slug,
    markdown: post(group, LONG_DESCRIPTION),
  })
  expect([created.isError, created.output['outcome']]).toEqual([false, 'saved'])
  const entry = record(created.output['entry'], 'the entry')
  const id = entry['id']
  expect([entry['version'], entry['status']]).toEqual([1, 'draft'])
  expect(record(created.output['verdict'], 'the verdict')['ok']).toBe(false)
  expect(problems(created.output['verdict'], 'errors')).toEqual([
    { contract: 'schema', path: '/frontmatter/description', severity: 'error' },
  ])
  expect(fixesOf(created.output['verdict'])).toEqual(['a fix'])

  const blocked = await agent.call('publish', { id, version: 1 })
  expect([blocked.isError, blocked.output['outcome']]).toEqual([true, 'blocked'])
  expect(problems(blocked.output['verdict'], 'errors')).toEqual([
    { contract: 'schema', path: '/frontmatter/description', severity: 'error' },
  ])

  const fixedMarkdown = post(group, DESCRIPTION)
  const fixed = await agent.call('update_draft', { id, version: 1, markdown: fixedMarkdown })
  expect([fixed.isError, fixed.output['outcome']]).toEqual([false, 'saved'])
  expect(record(fixed.output['entry'], 'the entry')['version']).toBe(2)
  expect(problems(fixed.output['verdict'], 'errors')).toEqual([])

  const read = async () => {
    const answer = await agent.call('get_entry', { collection: 'blog', locale: 'en', slug })
    return record(answer.output['entry'], 'the entry')
  }
  const head = await read()
  const stale = await agent.call('update_draft', {
    id,
    version: 1,
    markdown: post(group, 'A write from a stale copy of the entry.'),
  })
  expect([stale.isError, stale.output['outcome']]).toEqual([true, 'conflict'])
  expect(stale.output['conflict']).toEqual({ currentVersion: 2, headRevision: head['revision'] })
  const sameFile = await agent.call('update_draft', { id, version: 1, markdown: fixedMarkdown })
  expect([sameFile.isError, sameFile.output['outcome']]).toEqual([true, 'conflict'])
  const afterConflict = await read()
  expect([afterConflict['version'], afterConflict['revision'], afterConflict['markdown']]).toEqual([
    2,
    head['revision'],
    fixedMarkdown,
  ])
  const [revisions] = await project.query(
    `SELECT count(*) AS n FROM revisions WHERE entry_id = '${String(id)}'`,
  )
  expect(revisions).toEqual([{ n: 2 }])

  const validated = await agent.call('validate', {
    collection: 'blog',
    locale: 'en',
    slug,
    markdown: fixedMarkdown,
  })
  expect([validated.isError, validated.output['outcome']]).toEqual([false, 'ok'])
  const verdict = record(validated.output['verdict'], 'the verdict')
  expect([verdict['ok'], verdict['phase']]).toEqual([true, 'publish'])
  expect(problems(verdict, 'warnings')).toEqual(WARNINGS)
  expect((await read())['version']).toBe(2)

  return { id, read }
}

describe('AC-0.1-3: an agent of the 2026 era writes and publishes, acknowledging warnings in the call', () => {
  let agent: Agent | undefined

  afterAll(async () => {
    await agent?.close()
  })

  it('is asked about the warnings once, in the middle of publish, and its yes publishes', async () => {
    const replies: Reply[] = [{ action: 'accept', content: { acknowledge: true } }]
    agent = await connectAgent(url, token, {
      era: '2026',
      elicit: () => replies.shift() ?? { action: 'cancel' },
    })
    expect(agent.protocolVersion()).toBe('2026-07-28')
    const { id, read } = await writeAsAnAgent(agent, 'agents-write-2026', 'agents-write-2026')

    const published = await agent.call('publish', { id, version: 2 })

    expect([published.isError, published.output['outcome']]).toEqual([false, 'published'])
    expect(agent.questions).toHaveLength(1)
    expect(agent.questions[0]).toContain('2 warnings')
    for (const { contract } of WARNINGS) expect(agent.questions[0]).toContain(contract)
    const entry = await read()
    const publication = record(entry['lastPublication'], 'the last publication')
    expect([entry['status'], publication['revision'], publication['acknowledged']]).toEqual([
      'published',
      entry['revision'],
      ACKNOWLEDGED,
    ])
  })
})

describe('AC-0.1-4: an agent that cannot be asked acknowledges the warnings itself', () => {
  it.each<[Era, string]>([
    ['2025', '2025-11-25'],
    ['2026', '2026-07-28'],
  ])(
    'a %s client without forms gets needs_acknowledgement, then publishes with the warnings',
    async (era, revision) => {
      const agent = await connectAgent(url, token, { era })
      try {
        expect(agent.protocolVersion()).toBe(revision)
        const slug = `agents-write-${era}-acknowledged`
        const { id, read } = await writeAsAnAgent(agent, slug, slug)

        const asked = await agent.call('publish', { id, version: 2 })
        expect([asked.isError, asked.output['outcome']]).toEqual([false, 'needs_acknowledgement'])
        expect(problems(asked.output['verdict'], 'warnings')).toEqual(WARNINGS)
        expect((await read())['status']).toBe('draft')

        const published = await agent.call('publish', {
          id,
          version: 2,
          acknowledgeWarnings: ACKNOWLEDGED,
        })
        expect([published.isError, published.output['outcome']]).toEqual([false, 'published'])
        const entry = await read()
        const publication = record(entry['lastPublication'], 'the last publication')
        expect([entry['status'], publication['acknowledged']]).toEqual(['published', ACKNOWLEDGED])
      } finally {
        await agent.close()
      }
    },
  )
})
