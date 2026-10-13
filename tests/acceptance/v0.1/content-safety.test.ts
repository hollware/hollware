import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import {
  agentWith,
  createPlaygroundHarness,
  migrate,
  publishNew,
  seedOwnerToken,
  siteFetch,
  type Agent,
} from './support/harness.ts'

// Fails when: content safety stops working the way AC-0.1-14 describes, on the built playground:
// a draft with raw HTML, an unknown component, a disallowed attribute and a javascript: link stops
// being saved, or its verdict stops reporting each with an error and a fix; publishing it stops
// being blocked; the stored Markdown is changed; or the HTML of a published entry, from get_entry
// or from the example site, lets HTML that the Markdown only quotes through as markup.

const server = createPlaygroundHarness()
let agent: Agent

beforeAll(async () => {
  await server.listen()
  await migrate(server)
  agent = agentWith(server, await seedOwnerToken(server))
})

afterAll(async () => {
  await server.close()
})

const FRONTMATTER = (slug: string) =>
  `---\ntitle: A post about ${slug}\ndescription: A post that tests what content safety lets through.\ndate: 2026-10-13\ntags:\n  - cms\ntranslationGroup: ${slug}\n---\n\n`

/** Raw HTML, a misspelled component, an event handler and a javascript: link. */
const HOSTILE = `${FRONTMATTER('four-problems')}Inline HTML: <span>raw</span>.

::youtub{id="dQw4w9WgXcQ"}
::

A [link](/en/blog/edge-caching-basics/){onclick="alert(1)"}.

A [script link](javascript:alert(1)).
`

/** HTML that the Markdown only quotes, in inline code and in a code block. */
const QUOTED = `${FRONTMATTER('quoted-html')}Never write \`<script>alert(1)</script>\` in a post.

\`\`\`html
<iframe src="https://example.com"></iframe>
\`\`\`
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The contract of each error of a verdict, by name, and whether it carries a fix. */
function errorsOf(verdict: unknown): [string, boolean][] {
  const errors = isRecord(verdict) ? verdict['errors'] : undefined
  if (!Array.isArray(errors)) throw new Error(`no errors: ${JSON.stringify(verdict)}`)
  return errors
    .map((error: unknown): [string, boolean] => [
      isRecord(error) ? String(error['contract']) : '',
      isRecord(error) && typeof error['fix'] === 'string' && error['fix'].trim() !== '',
    ])
    .sort(([a], [b]) => a.localeCompare(b))
}

describe('AC-0.1-14: content safety', () => {
  it('saves the hostile draft with one error and a fix for each problem, and blocks its publish', async () => {
    const created = await agent.call('create_draft', {
      collection: 'blog',
      locale: 'en',
      slug: 'four-problems',
      markdown: HOSTILE,
    })
    const entry = created.output['entry']
    const id = isRecord(entry) ? entry['id'] : undefined
    const published = await agent.call('publish', { id, version: 1 })
    const stored = await agent.call('get_entry', {
      collection: 'blog',
      locale: 'en',
      slug: 'four-problems',
    })

    expect([created.isError, created.output['outcome']]).toEqual([false, 'saved'])
    expect(errorsOf(created.output['verdict'])).toEqual([
      ['disallowed-attribute', true],
      ['raw-html', true],
      ['unknown-component', true],
      ['unsafe-url', true],
    ])
    expect([published.isError, published.output['outcome']]).toEqual([true, 'blocked'])
    expect(errorsOf(published.output['verdict'])).toEqual([
      ['disallowed-attribute', true],
      ['raw-html', true],
      ['unknown-component', true],
      ['unsafe-url', true],
    ])
    expect(stored.output['entry']).toMatchObject({ markdown: HOSTILE, status: 'draft' })
  })

  it('publishes HTML that a post quotes as text, never as markup', async () => {
    await publishNew(agent, { locale: 'en', slug: 'quoted-html', markdown: QUOTED })
    const read = await agent.call('get_entry', {
      collection: 'blog',
      locale: 'en',
      slug: 'quoted-html',
      formats: ['html'],
    })
    const entry = read.output['entry']
    const html = isRecord(entry) && typeof entry['html'] === 'string' ? entry['html'] : ''
    const page = await (await siteFetch(server, '/en/blog/quoted-html/')).text()

    expect(html).toBe(
      '<p>Never write <code>&lt;script&gt;alert(1)&lt;/script&gt;</code> in a post.</p>\n' +
        '<pre language="html"><code class="language-html">&lt;iframe src="https://example.com"&gt;&lt;/iframe&gt;</code></pre>',
    )
    for (const markup of [html, page]) {
      expect(markup).not.toMatch(/<script|<iframe/i)
    }
  })
})
