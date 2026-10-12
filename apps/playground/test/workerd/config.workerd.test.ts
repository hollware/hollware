import { describe, expect, it } from 'vitest'

import config from '../../hollware.config.ts'

// Fails when: hollware.config.ts stops describing one site with a bilingual blog whose schema
// takes the frontmatter of the corpus (tests/fixtures/content/blog) and refuses a description over
// 160 characters, whose components refuse props they do not declare, or whose seo-title-length
// contract stops warning about a title over 60 characters.

const site = config.sites['playground']
const blog = site?.collections['blog']

const FRONTMATTER = {
  title: 'Edge caching basics',
  description: 'What an edge cache keeps, for how long, and how a publish clears it.',
  date: '2026-09-01',
  tags: ['cloudflare', 'cms'],
  translationGroup: 'edge-caching',
}

describe('the playground config', () => {
  it('has one bilingual site with a blog routed per locale', () => {
    expect(Object.keys(config.sites)).toEqual(['playground'])
    expect(site?.locales).toEqual(['es', 'en'])
    expect(blog?.routes).toEqual({ es: '/blog/:slug/', en: '/en/blog/:slug/' })
    expect([blog?.translations?.groupBy, blog?.tags, blog?.sortBy]).toEqual([
      'translationGroup',
      'tags',
      'date',
    ])
  })

  it('takes the frontmatter of the corpus and refuses a long description', async () => {
    const accepted = await blog?.schema['~standard'].validate(FRONTMATTER)
    expect(accepted).toEqual({ value: FRONTMATTER })
    const refused = await blog?.schema['~standard'].validate({
      ...FRONTMATTER,
      description: 'x'.repeat(161),
    })
    expect(refused?.issues?.map((issue) => issue.path)).toEqual([['description']])
  })

  it('refuses component props that a component does not declare', async () => {
    const callout = blog?.components?.['callout']?.props['~standard']
    expect(await callout?.validate({ type: 'tip' })).toEqual({ value: { type: 'tip' } })
    const unknown = await callout?.validate({ type: 'tip', onclick: 'alert(1)' })
    expect(unknown?.issues?.map((issue) => issue.message)).toEqual(['Unrecognized key: "onclick"'])
  })

  it('warns about a title over 60 characters without a seoTitle', async () => {
    const contract = blog?.contracts?.find((candidate) => candidate.id === 'seo-title-length')
    const check = (title: string, seoTitle?: string) =>
      contract?.check({
        site: 'playground',
        collection: 'blog',
        locale: 'en',
        slug: 'a-post',
        entryId: null,
        phase: 'write',
        frontmatter: { ...FRONTMATTER, title, ...(seoTitle === undefined ? {} : { seoTitle }) },
        markdown: {
          frontmatter: {},
          document: { nodes: [], frontmatter: {}, meta: {} },
          extracted: {
            headings: [],
            links: [],
            images: [],
            components: [],
            words: 0,
            disallowed: [],
          },
          comarkVersion: '0.7.0',
          pipelineVersion: 'test',
        },
        entries: {
          lookupMany: () => Promise.resolve([]),
          translations: () => Promise.resolve([]),
        },
      })
    expect(await check('x'.repeat(60))).toEqual([])
    expect(await check('x'.repeat(61), 'A short title')).toEqual([])
    expect(await check('x'.repeat(61))).toEqual([
      {
        path: '/frontmatter/title',
        message: 'The title has 61 characters; search engines show about 60.',
        fix: 'Shorten the title to 60 characters or fewer, or add a seoTitle of at most 60.',
      },
    ])
  })
})
