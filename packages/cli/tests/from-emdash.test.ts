import { describe, expect, it } from 'vite-plus/test'

import {
  corpusFromEmdash,
  EmdashError,
  siteFromPackage,
  siteFromSeed,
} from '../src/import/from-emdash.ts'

// Fails when: an import from EmDash (src/import/from-emdash.ts) stops making each entry of a site
// package or of a seed file the Markdown file Hollware imports: its path, its frontmatter from the
// fields of text, number, yes or no, date and choice, its body from its first Portable Text field,
// its translation group in the field given; stops leaving out an entry in EmDash's trash; stops
// reporting a field or a block it leaves out; stops marking what EmDash had published; or takes a
// slug that is not one, or a package without its manifest.

const encoder = new TextEncoder()
const ndjson = (...records: object[]) =>
  encoder.encode(records.map((record) => `${JSON.stringify(record)}\n`).join(''))
const paragraph = (value: string) => ({
  _type: 'block',
  style: 'normal',
  markDefs: [],
  children: [{ _type: 'span', text: value, marks: [] }],
})

const PACKAGE = new Map<string, Uint8Array>([
  ['manifest.json', encoder.encode('{"formatVersion":1}')],
  [
    'records/collection/000000.ndjson',
    ndjson({ kind: 'collection', id: 'col_posts', slug: 'posts' }),
  ],
  [
    'records/field/000000.ndjson',
    ndjson(
      { kind: 'field', id: 'f1', collectionId: 'col_posts', slug: 'title', type: 'string' },
      { kind: 'field', id: 'f2', collectionId: 'col_posts', slug: 'content', type: 'portableText' },
      { kind: 'field', id: 'f3', collectionId: 'col_posts', slug: 'featured_image', type: 'image' },
      { kind: 'field', id: 'f4', collectionId: 'col_posts', slug: 'tags', type: 'multiSelect' },
      { kind: 'field', id: 'f5', collectionId: 'col_posts', slug: 'reading_time', type: 'number' },
    ),
  ],
  [
    'records/entry/000000.ndjson',
    ndjson(
      {
        kind: 'entry',
        id: 'ent_1',
        collection: 'posts',
        slug: 'edge-caching',
        status: 'published',
        locale: 'en',
        translationGroup: 'grp_1',
        fields: {
          title: 'Edge caching',
          content: [paragraph('Pages stay at the edge.'), { _type: 'pullQuote', text: 'x' }],
          featured_image: '{"id":"med_1"}',
          tags: ['cloudflare', 'cms'],
          reading_time: 4,
        },
      },
      {
        kind: 'entry',
        id: 'ent_2',
        collection: 'posts',
        slug: 'cache-en-el-borde',
        status: 'draft',
        locale: 'es',
        translationGroup: 'grp_1',
        fields: {
          title: 'Caché en el borde',
          content: [paragraph('Las páginas quedan en el borde.')],
        },
      },
      {
        kind: 'entry',
        id: 'ent_3',
        collection: 'posts',
        slug: 'gone',
        status: 'draft',
        locale: 'en',
        deletedAt: '2026-10-01T00:00:00.000Z',
        fields: { title: 'Gone' },
      },
      {
        kind: 'entry',
        id: 'ent_4',
        collection: 'posts',
        slug: 'Not A Slug',
        locale: 'en',
        fields: {},
      },
    ),
  ],
])

describe('an EmDash site package', () => {
  it('makes each entry the Markdown file import sends, and says what it left out', () => {
    const corpus = corpusFromEmdash(siteFromPackage(PACKAGE))

    expect(corpus.files).toEqual([
      {
        path: 'posts/en/edge-caching.md',
        collection: 'posts',
        locale: 'en',
        slug: 'edge-caching',
        markdown: [
          '---',
          'title: "Edge caching"',
          'tags:',
          '  - "cloudflare"',
          '  - "cms"',
          'reading_time: 4',
          'translationGroup: "grp_1"',
          '---',
          '',
          'Pages stay at the edge.',
          '',
        ].join('\n'),
      },
      {
        path: 'posts/es/cache-en-el-borde.md',
        collection: 'posts',
        locale: 'es',
        slug: 'cache-en-el-borde',
        markdown: [
          '---',
          'title: "Caché en el borde"',
          'translationGroup: "grp_1"',
          '---',
          '',
          'Las páginas quedan en el borde.',
          '',
        ].join('\n'),
      },
    ])
    expect([...corpus.published]).toEqual(['posts/en/edge-caching.md'])
    expect(corpus.leftOut).toEqual([
      {
        path: 'posts/en/edge-caching.md',
        what: ['a pullQuote block', 'the field featured_image (image)'],
      },
    ])
    expect(corpus.problems).toEqual([
      {
        path: 'posts/en/Not A Slug.md',
        reason: '"Not A Slug" is not a slug: lowercase words and digits joined by hyphens',
      },
    ])
  })

  it('names the translation group as the collection does, and refuses what is no package', () => {
    const corpus = corpusFromEmdash(siteFromPackage(PACKAGE), 'group')
    expect(corpus.files[1]?.markdown).toContain('group: "grp_1"')
    expect(() => siteFromPackage(new Map())).toThrow(
      new EmdashError('This is no EmDash site package: it has no manifest.json.'),
    )
  })
})

describe('an EmDash seed file', () => {
  it('reads its collections and content, in the locale given when an item has none', () => {
    const seed = {
      collections: [
        {
          slug: 'pages',
          fields: [
            { slug: 'title', type: 'string' },
            { slug: 'content', type: 'portableText' },
          ],
        },
      ],
      content: {
        pages: [
          {
            id: 'about',
            slug: 'about',
            status: 'published',
            data: { title: 'About', content: [paragraph('Hi.')] },
          },
        ],
      },
    }

    const corpus = corpusFromEmdash(siteFromSeed(seed, 'es'))

    expect(corpus.files).toEqual([
      {
        path: 'pages/es/about.md',
        collection: 'pages',
        locale: 'es',
        slug: 'about',
        markdown: '---\ntitle: "About"\n---\n\nHi.\n',
      },
    ])
    expect([...corpus.published]).toEqual(['pages/es/about.md'])
    expect(() => siteFromSeed({ collections: [] })).toThrow(
      new EmdashError('This is no EmDash seed file: it has no "content".'),
    )
  })
})
