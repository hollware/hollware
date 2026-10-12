import { exports } from 'cloudflare:workers'
import { escapeHtml } from 'comark/utils'
import { describe, expect, it } from 'vitest'
import { SMALL_POST } from '../../src/fixtures.ts'
import { parseDocument, processMarkdown, renderDocument } from '../../src/pipeline.ts'
import {
  SMALL_POST_COMPONENTS,
  SMALL_POST_FRONTMATTER,
  SMALL_POST_HEADINGS,
  SMALL_POST_HTML,
  SMALL_POST_IMAGES,
  SMALL_POST_LINKS,
} from '../support/small-post.ts'

// S3a. Fails when: Comark stops parsing any construct of SMALL_POST inside workerd, when the
// frontmatter, the heading ids, the component nodes or the HTML of @comark/html change, when
// extract() in src/pipeline.ts misreads a heading, link, image or component, or when the Worker in
// src/index.ts stops returning the same data over HTTP.
//
// Run by the vitest pool `@cloudflare/vitest-plugin`, which keeps Node.js compatibility ON for
// its own runner (see test/node/built-worker.test.ts for the run without it).

describe('Comark parses a document with every construct inside workerd', () => {
  it('runs in workerd, not in Node', () => {
    expect(navigator.userAgent).toBe('Cloudflare-Workers')
  })

  it('returns the exact frontmatter object (YAML dates stay strings)', async () => {
    const document = await parseDocument(SMALL_POST)

    expect(document.frontmatter).toStrictEqual(SMALL_POST_FRONTMATTER)
    expect(document.meta).toStrictEqual({})
  })

  it('extracts the exact headings: depth, text and id (h3 ids carry the parent slug)', async () => {
    const { extracted } = await processMarkdown(SMALL_POST)

    expect(extracted.headings).toStrictEqual(SMALL_POST_HEADINGS)
  })

  it('represents the block component with its props and the inline component inside its slot', async () => {
    const document = await parseDocument(SMALL_POST)

    expect(document.nodes[5]).toStrictEqual([
      'callout',
      { type: 'tip', title: 'Rule of thumb' },
      'Keep the ',
      ['strong', {}, 'duty cycle'],
      ' under 2%, and read the ',
      ['badge', { tone: 'blue' }, 'cold'],
      ' sensors last.',
    ])
  })

  it('renders the exact HTML with @comark/html (components stay custom elements)', async () => {
    const html = await renderDocument(await parseDocument(SMALL_POST))

    expect(html).toBe(SMALL_POST_HTML)
  })

  it('renders components with custom handlers; children go through state.flow', async () => {
    const html = await renderDocument(await parseDocument(SMALL_POST), {
      callout: async (node, state) =>
        `<aside class="callout callout-${escapeHtml(String(node[1].type))}"><strong>${escapeHtml(String(node[1].title))}</strong> ${await state.flow(node, state)}</aside>\n`,
      badge: async (node, state) =>
        `<span class="badge badge-${escapeHtml(String(node[1].tone))}">${await state.flow(node, state)}</span>`,
    })

    expect(html).toContain(
      '<aside class="callout callout-tip"><strong>Rule of thumb</strong> Keep the <strong>duty cycle</strong> under 2%, and read the <span class="badge badge-blue">cold</span> sensors last.</aside>\n<h3 id=',
    )
  })

  it('shows that the documented render(children) pattern breaks when the first child is text', async () => {
    // README of @comark/html: `alert: async ([, attrs, ...children], { render }) => ... render(children)`.
    // state.render() takes an array whose first item is a string for an element node, so a list of
    // children that starts with text ("Keep the ", ...) is read as the element <Keep the ...>.
    const html = await renderDocument(await parseDocument(SMALL_POST), {
      callout: async ([, , ...children], state) =>
        `<aside>${await state.render(children)}</aside>\n`,
    })

    expect(html).toContain('<aside><Keep the  >\n')
  })
})

describe('the Worker built from the same code', () => {
  it('answers POST /process with frontmatter, extracted data and the same HTML', async () => {
    const response = await exports.default.fetch('http://spike.test/process', {
      method: 'POST',
      body: SMALL_POST,
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toStrictEqual({
      frontmatter: SMALL_POST_FRONTMATTER,
      extracted: {
        headings: SMALL_POST_HEADINGS,
        links: SMALL_POST_LINKS,
        images: SMALL_POST_IMAGES,
        components: SMALL_POST_COMPONENTS,
        words: 82,
      },
      html: SMALL_POST_HTML,
    })
  })

  it('answers GET /health and 404', async () => {
    const health = await exports.default.fetch('http://spike.test/health')
    const missing = await exports.default.fetch('http://spike.test/nope')

    expect(await health.json()).toStrictEqual({ ok: true, comark: '0.7.0' })
    expect(missing.status).toBe(404)
  })
})
