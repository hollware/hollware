import { describe, expect, it } from 'vite-plus/test'

import {
  bodyOf,
  fieldsOf,
  markdownOnly,
  readFrontmatter,
  referencesOf,
  setField,
  withBody,
} from '../app/lib/frontmatter.ts'
import { pageUrl } from '../app/lib/site.ts'

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
    cover: { type: 'string', pattern: '^asset:ast_[0-9a-f]{26}$' },
    meta: { type: 'object' },
    links: { type: 'array', items: { type: 'object' } },
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
      ['cover', 'image', false, []],
    ])
  })

  it('names what the form leaves to the Markdown, and never what Hollware fills', () => {
    expect(markdownOnly(SCHEMA)).toEqual(['meta', 'links'])
  })

  it('reads which fields name entries of another collection from the reference rules', () => {
    expect(
      referencesOf(
        [
          { rule: 'reference', params: { field: 'related', collection: 'blog' } },
          { rule: 'reference', params: { field: 'author', collection: 'people', locale: 'en' } },
          { rule: 'translations-of', params: { field: 'title', collection: 'blog' } },
          { rule: 'reference', params: { field: 3, collection: 'blog' } },
        ],
        'es',
      ),
    ).toEqual({
      related: { collection: 'blog', locale: 'es' },
      author: { collection: 'people', locale: 'en' },
    })
  })
})

describe('the frontmatter of a file', () => {
  const FILE = '---\ntitle: "Hello: world"\ntags:\n  - a\n---\n\n# Hello\n\nBody, kept.\n'

  it('reads the values, and nothing from a block that does not parse', () => {
    expect(readFrontmatter(FILE)).toEqual({ title: 'Hello: world', tags: ['a'] })
    expect(readFrontmatter('---\ntitle: [\n---\nBody')).toBeNull()
    expect(readFrontmatter('No frontmatter.')).toBeNull()
  })

  it('changes the one field it is given and keeps every other byte, comments included', () => {
    const file =
      '---\ntitle: "Hello: world"\n# the date it was written\ndate: 2026-10-15\ntags: [a, b]\n---\n\n# Hello\n\nBody, kept.\n'

    expect(setField(file, 'date', '2026-10-16')).toBe(
      '---\ntitle: "Hello: world"\n# the date it was written\ndate: 2026-10-16\ntags: [a, b]\n---\n\n# Hello\n\nBody, kept.\n',
    )
    expect(setField(file, 'tags', undefined)).toBe(
      '---\ntitle: "Hello: world"\n# the date it was written\ndate: 2026-10-15\n---\n\n# Hello\n\nBody, kept.\n',
    )
    expect(setField('Just a body.\n', 'title', 'T')).toBe('---\ntitle: T\n---\n\nJust a body.\n')
    expect(setField('---\ntitle: [\n---\nBody', 'title', 'T')).toBe('---\ntitle: [\n---\nBody')
  })

  it('gives the body apart, and puts a new body under the same frontmatter', () => {
    expect(bodyOf(FILE)).toBe('# Hello\n\nBody, kept.\n')
    expect(withBody(FILE, 'New body.\n')).toBe(
      '---\ntitle: "Hello: world"\ntags:\n  - a\n---\n\nNew body.\n',
    )
    expect(bodyOf('No frontmatter.\n')).toBe('No frontmatter.\n')
    expect(withBody('Old.\n', 'New.\n')).toBe('New.\n')
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
