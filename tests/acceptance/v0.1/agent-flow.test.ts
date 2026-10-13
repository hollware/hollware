import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { connectAgent, type Agent, type Era, type Reply } from './support/agent.ts'
import { createProject, setUpProject, type Project } from './support/project.ts'

// Fails when: an agent stops being able to write and publish through MCP the way AC-0.1-3 and
// AC-0.1-4 describe it, against the built playground under `wrangler dev`: describe_site stops
// giving the schema and the style guides; an invalid draft stops being saved with its errors and
// their fixes, or publishing it stops being blocked; a fix stops saving version 2; a write against
// version 1 stops answering conflict, or saves a revision anyway; validate starts saving; publish
// stops asking a 2026 client that can show a form about the warnings (MRTR), or stops answering
// needs_acknowledgement to a 2025 client and to a 2026 client that cannot, or stops publishing
// once they are acknowledged; or the publication stops recording what was acknowledged.

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

/** A post of the playground's blog, alone in its translation group, with a long title. */
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

/** The id, the path and the severity of each problem of a verdict, which is what a test pins. */
function problems(verdict: unknown, kind: 'errors' | 'warnings') {
  return list(record(verdict, 'the verdict')[kind], kind).map((item) => {
    const problem = record(item, 'a problem')
    return { contract: problem['contract'], path: problem['path'], severity: problem['severity'] }
  })
}

/** Every problem of a verdict says how to fix it, in words of its own. */
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

/** The two warnings publish asks about: the long title and the missing translation. */
const WARNINGS = [
  { contract: 'translation-pair', path: '/frontmatter/translationGroup', severity: 'warning' },
  { contract: 'seo-title-length', path: '/frontmatter/title', severity: 'warning' },
]
const ACKNOWLEDGED = WARNINGS.map(({ contract, path }) => ({ contract, path }))

/**
 * Steps 1 to 6 of AC-0.1-3, the writes: from describe_site to validate. It returns the entry,
 * at version 2 with no errors, ready to publish.
 */
async function writeAsAnAgent(agent: Agent, slug: string, group: string) {
  // 1. describe_site gives the JSON Schema of the frontmatter and the style guides.
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

  // 2. An invalid draft is saved at version 1, and its verdict lists the error with its fix.
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
  // The contracts that read the frontmatter, such as the title's warning, wait until it passes.
  expect(fixesOf(created.output['verdict'])).toEqual(['a fix'])

  // 3. publish is blocked by the error.
  const blocked = await agent.call('publish', { id, version: 1 })
  expect([blocked.isError, blocked.output['outcome']]).toEqual([true, 'blocked'])
  expect(problems(blocked.output['verdict'], 'errors')).toEqual([
    { contract: 'schema', path: '/frontmatter/description', severity: 'error' },
  ])

  // 4. The fix saves version 2, with no error left.
  const fixedMarkdown = post(group, DESCRIPTION)
  const fixed = await agent.call('update_draft', { id, version: 1, markdown: fixedMarkdown })
  expect([fixed.isError, fixed.output['outcome']]).toEqual([false, 'saved'])
  expect(record(fixed.output['entry'], 'the entry')['version']).toBe(2)
  expect(problems(fixed.output['verdict'], 'errors')).toEqual([])

  // 5. A write against version 1 is a conflict that names version 2, and saves nothing.
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
  // Whatever it says: a stale write of the very file that is saved is a conflict too, not unchanged.
  const sameFile = await agent.call('update_draft', { id, version: 1, markdown: fixedMarkdown })
  expect([sameFile.isError, sameFile.output['outcome']]).toEqual([true, 'conflict'])
  const afterConflict = await read()
  expect([afterConflict['version'], afterConflict['revision'], afterConflict['markdown']]).toEqual([
    2,
    head['revision'],
    fixedMarkdown,
  ])
  // Not even a revision that no entry points at: the entry has the two of versions 1 and 2.
  const [revisions] = await project.query(
    `SELECT count(*) AS n FROM revisions WHERE entry_id = '${String(id)}'`,
  )
  expect(revisions).toEqual([{ n: 2 }])

  // 6. validate checks the file as publish would, and saves nothing.
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
