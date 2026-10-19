import { describe, expect, it } from 'vite-plus/test'

import { fieldsOf, readFrontmatter, writeFrontmatter } from '../app/lib/frontmatter.ts'
import { pageUrl } from '../app/lib/site.ts'

// Fails when: the form of the frontmatter (app/lib/frontmatter.ts) stops making a field of each
// property its schema describes, of the kind the editor shows (a date, a choice, a list of
// strings, a long text over 120 characters, a number, a switch), with what is required, or makes
// one of a field Hollware fills (readOnly); stops
// reading the values of a frontmatter, or reads one that does not parse; or, writing the values
// back, changes anything of the body; or the link of an entry to its page (app/lib/site.ts) stops
// joining the site's origin and the route of its locale with its slug.

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1 },
    description: { type: 'string', maxLength: 160 },
    date: { type: 'string', format: 'date' },
    section: { type: 'string', enum: ['start', 'guides'] },
    tags: { type: 'array', items: { type: 'string' } },
    order: { type: 'integer' },
    featured: { type: 'boolean' },
    meta: { type: 'object' },
    // Filled by Hollware (automaticFields): nobody writes it.
    minutes: { type: 'integer', readOnly: true },
  },
  required: ['title', 'date'],
}

describe('fieldsOf', () => {
  it('makes a field of each property it knows, of its kind, with what is required, and none of what Hollware fills', () => {
    expect(
      fieldsOf(SCHEMA).map(({ key, kind, required, options }) => [key, kind, required, options]),
    ).toEqual([
      ['title', 'text', true, []],
      ['description', 'long', false, []],
      ['date', 'date', true, []],
      ['section', 'choice', false, ['start', 'guides']],
      ['tags', 'list', false, []],
      ['order', 'number', false, []],
      ['featured', 'switch', false, []],
    ])
  })
})

describe('the frontmatter of a file', () => {
  const FILE = '---\ntitle: "Hello: world"\ntags:\n  - a\n---\n\n# Hello\n\nBody, kept.\n'

  it('reads the values, and nothing from a block that does not parse', () => {
    expect(readFrontmatter(FILE)).toEqual({ title: 'Hello: world', tags: ['a'] })
    expect(readFrontmatter('---\ntitle: [\n---\nBody')).toBeNull()
    expect(readFrontmatter('No frontmatter.')).toBeNull()
  })

  it('writes the values back and keeps the body byte for byte', () => {
    const written = writeFrontmatter(FILE, {
      title: 'Hello: world',
      tags: ['a', 'b'],
      date: '2026-10-16',
    })

    expect(written).toBe(
      '---\ntitle: "Hello: world"\ntags:\n  - a\n  - b\ndate: 2026-10-16\n---\n\n# Hello\n\nBody, kept.\n',
    )
    expect(readFrontmatter(written)).toEqual({
      title: 'Hello: world',
      tags: ['a', 'b'],
      date: '2026-10-16',
    })
    expect(writeFrontmatter('Just a body.\n', { title: 'T' })).toBe(
      '---\ntitle: T\n---\n\nJust a body.\n',
    )
  })
})

describe('pageUrl', () => {
  it('joins the origin and the route of the locale with the slug', () => {
    const routes = { es: '/blog/:slug/', en: '/en/blog/:slug/' }

    expect(pageUrl('https://example.com/', routes, 'en', 'hello')).toBe(
      'https://example.com/en/blog/hello/',
    )
    expect(pageUrl(null, routes, 'en', 'hello')).toBeNull()
    expect(pageUrl('https://example.com', routes, 'fr', 'hello')).toBeNull()
  })
})
