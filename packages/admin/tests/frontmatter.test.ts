import { describe, expect, it } from 'vite-plus/test'

import {
  addItem,
  bodyOf,
  fieldsOf,
  flatValues,
  itemTitle,
  markdownOnly,
  moveItem,
  newItem,
  readFrontmatter,
  referencesOf,
  removeItem,
  setField,
  valueAt,
  withBody,
  type Field,
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

const SETTINGS = {
  type: 'object',
  properties: {
    footer: {
      type: 'object',
      properties: {
        note: { type: 'string', maxLength: 200 },
        columns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', maxLength: 40 },
              links: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    href: { type: 'string' },
                    icon: { type: 'string', pattern: '^asset:ast_[0-9a-f]{26}$' },
                  },
                  required: ['label', 'href'],
                },
              },
            },
            required: ['title'],
          },
        },
      },
      required: ['columns'],
    },
    audience: { type: 'array', items: { type: 'string', enum: ['buyers', 'admins'] } },
    hero: {
      type: 'object',
      properties: {
        layout: { type: 'string', enum: ['left', 'center'] },
        visible: { type: 'boolean' },
        order: { type: 'integer' },
      },
      required: ['layout', 'visible', 'order'],
    },
  },
  required: ['footer'],
}

type Shape = [string, string, boolean, readonly string[], number | null, Shape[]]

function shapeOf(field: Field): Shape {
  return [
    field.key,
    field.kind,
    field.required,
    field.options,
    field.maxLength,
    field.fields.map(shapeOf),
  ]
}

describe('nested fields', () => {
  it('makes a fieldset of an object and a list of cards of an array of objects, two levels down', () => {
    expect(fieldsOf(SETTINGS).map(shapeOf)).toEqual([
      [
        'footer',
        'object',
        true,
        [],
        null,
        [
          ['note', 'long', false, [], 200, []],
          [
            'columns',
            'objects',
            true,
            [],
            null,
            [
              ['title', 'text', true, [], 40, []],
              [
                'links',
                'objects',
                false,
                [],
                null,
                [
                  ['label', 'text', true, [], null, []],
                  ['href', 'text', true, [], null, []],
                  ['icon', 'image', false, [], null, []],
                ],
              ],
            ],
          ],
        ],
      ],
      ['audience', 'choices', false, ['buyers', 'admins'], null, []],
      [
        'hero',
        'object',
        false,
        [],
        null,
        [
          ['layout', 'choice', true, ['left', 'center'], null, []],
          ['visible', 'switch', true, [], null, []],
          ['order', 'number', true, [], null, []],
        ],
      ],
    ])
    expect(markdownOnly(SETTINGS)).toEqual([])
  })

  it('stops five objects down, and leaves the deeper one to the Markdown', () => {
    const deep = (levels: number): Record<string, unknown> =>
      levels === 0
        ? { type: 'string' }
        : { type: 'object', properties: { inner: deep(levels - 1) } }
    expect(markdownOnly({ type: 'object', properties: { top: deep(4) } })).toEqual([])
    expect(markdownOnly({ type: 'object', properties: { top: deep(5) } })).toEqual(['top'])
  })

  it('starts a new item with a value for each required field, and none for the rest', () => {
    const columns = fieldsOf(SETTINGS)[0]?.fields[1]
    const links = columns?.fields[1]
    const hero = fieldsOf(SETTINGS)[2]

    expect(newItem(columns?.fields ?? [])).toEqual({ title: '' })
    expect(newItem(links?.fields ?? [])).toEqual({ label: '', href: '' })
    expect(newItem(hero?.fields ?? [])).toEqual({ layout: 'left', visible: false, order: 0 })
    expect(newItem(fieldsOf(SETTINGS))).toEqual({ footer: { columns: [] } })
  })

  it('names an item by its first text field that holds words', () => {
    const fields = fieldsOf(SETTINGS)[0]?.fields[1]?.fields[1]?.fields ?? []

    expect(itemTitle({ label: 'Pricing', href: '/pricing' }, fields)).toBe('Pricing')
    expect(itemTitle({ label: '  ', href: '/pricing' }, fields)).toBe('/pricing')
    expect(itemTitle({ icon: 'asset:ast_1' }, fields)).toBeNull()
  })

  it('reads the value at a path, and nothing where the path does not fit the values', () => {
    const values = { footer: { columns: [{ title: 'Product' }] } }

    expect(valueAt(values, ['footer', 'columns', 0, 'title'])).toBe('Product')
    expect(valueAt(values, ['footer', 'columns', 'title'])).toBeUndefined()
    expect(valueAt(values, ['footer', 0])).toBeUndefined()
  })

  it('flattens values to one line each, under the path that holds them', () => {
    expect(
      flatValues({
        footer: { columns: [{ title: 'Product', links: [{ label: 'Pricing' }] }] },
        tags: ['a', 'b'],
        draft: false,
      }),
    ).toEqual([
      { path: ['footer', 'columns', '1', 'title'], text: 'Product' },
      { path: ['footer', 'columns', '1', 'links', '1', 'label'], text: 'Pricing' },
      { path: ['tags'], text: 'a, b' },
      { path: ['draft'], text: 'false' },
    ])
  })
})

describe('the items of a nested list', () => {
  const FILE = [
    '---',
    'title: Settings',
    '# the footer of every page',
    'footer:',
    '  columns:',
    '    - title: Product',
    '      links:',
    '        - label: Pricing',
    '          href: /pricing',
    '        - label: Docs # read most',
    '          href: /docs',
    '    - title: Company',
    '      links: []',
    '---',
    '',
    'Body, kept.',
    '',
  ].join('\n')

  it('changes one value deep in an item and keeps every other byte', () => {
    expect(setField(FILE, ['footer', 'columns', 0, 'links', 1, 'label'], 'Guides')).toBe(
      FILE.replace('label: Docs # read most', 'label: Guides # read most'),
    )
  })

  it('adds an item at the end, and opens an empty list into lines', () => {
    expect(addItem(FILE, ['footer', 'columns', 1, 'links'], { label: 'Jobs', href: '/jobs' })).toBe(
      FILE.replace(
        '      links: []\n',
        '      links:\n        - label: Jobs\n          href: /jobs\n',
      ),
    )
    expect(addItem('---\ntitle: T\n---\n', ['nav'], { label: 'Home' })).toBe(
      '---\ntitle: T\nnav:\n  - label: Home\n---\n',
    )
  })

  it('writes the first key of an empty item on a line of its own', () => {
    const added = addItem('---\nnav: []\n---\n', ['nav'], {})

    expect(added).toBe('---\nnav:\n  - {}\n---\n')
    expect(setField(added, ['nav', 0, 'label'], 'Home')).toBe('---\nnav:\n  - label: Home\n---\n')
  })

  it('removes the item it is given, and only it', () => {
    expect(removeItem(FILE, ['footer', 'columns', 0, 'links'], 0)).toBe(
      FILE.replace('        - label: Pricing\n          href: /pricing\n', ''),
    )
    expect(removeItem(FILE, ['footer', 'columns', 0, 'links'], 2)).toBe(FILE)
    expect(removeItem(FILE, ['footer', 'columns', 0, 'links'], -1)).toBe(FILE)
  })

  it('moves an item up or down with its comments, and nowhere past the ends', () => {
    expect(moveItem(FILE, ['footer', 'columns', 0, 'links'], 1, 0)).toBe(
      FILE.replace(
        '        - label: Pricing\n          href: /pricing\n        - label: Docs # read most\n          href: /docs\n',
        '        - label: Docs # read most\n          href: /docs\n        - label: Pricing\n          href: /pricing\n',
      ),
    )
    expect(moveItem(FILE, ['footer', 'columns', 0, 'links'], 0, 2)).toBe(FILE)
    expect(moveItem(FILE, ['footer', 'columns', 0, 'links'], 0, -1)).toBe(FILE)
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
