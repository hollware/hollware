import { describe, expect, it } from 'vite-plus/test'

import {
  factOf,
  faqOf,
  markdownPathOf,
  markdownTarget,
  ownsHead,
  pathOf,
  withFacts,
} from '../app/utils/pages.ts'

describe('the path of a page', () => {
  it('puts the home at the root, a page at its slug and an entry under its collection', () => {
    expect(pathOf('pages', 'home', 'en')).toBe('/')
    expect(pathOf('pages', 'home', 'es')).toBe('/es/')
    expect(pathOf('pages', 'install', 'es')).toBe('/es/install/')
    expect(pathOf('compare', 'wordpress', 'en')).toBe('/compare/wordpress/')
    expect(markdownPathOf('pages', 'home', 'es')).toBe('/es/index.md')
    expect(markdownPathOf('features', 'agents', 'en')).toBe('/features/agents.md')
  })

  it('reads the entry a .md path names, and leaves every other path alone', () => {
    expect(markdownTarget('/es/glossary/content-contracts.md')).toEqual({
      collection: 'glossary',
      slug: 'content-contracts',
      locale: 'es',
    })
    expect(markdownTarget('/docs/deploy.md')).toEqual({
      collection: 'docs',
      slug: 'deploy',
      locale: 'en',
    })
    expect(markdownTarget('/install.md')).toEqual({
      collection: 'pages',
      slug: 'install',
      locale: 'en',
    })
    expect(markdownTarget('/es/index.md')).toEqual({
      collection: 'pages',
      slug: 'home',
      locale: 'es',
    })
    for (const path of [
      '/llms.md',
      '/home.md',
      '/docs/deploy/',
      '/reference/events.md',
      '/a/b.md',
    ]) {
      expect(markdownTarget(path)).toBeNull()
    }
  })

  it('knows the pages that write their own head', () => {
    expect(
      ['/features/', '/es/compare/wordpress/', '/install/', '/es/media-kit/', '/home/'].map(
        ownsHead,
      ),
    ).toEqual([true, true, true, true, true])
    expect(['/', '/docs/deploy/', '/reference/events/', '/featuresx/'].map(ownsHead)).toEqual([
      false,
      false,
      false,
      false,
    ])
  })
})

describe('the facts of Hollware in the copy', () => {
  it('puts a known fact in place and leaves an unknown one as it was written', () => {
    expect(
      withFacts('MIT is :fact{name="license"}, :fact{name="nope"} :fact{name="constructor"}.'),
    ).toBe('MIT is MIT, :fact{name="nope"} :fact{name="constructor"}.')
    expect(factOf('license')).toBe('MIT')
    expect(factOf('toString')).toBe('')
    expect(Number(factOf('tools'))).toBeGreaterThan(30)
  })
})

describe('the questions of a page', () => {
  it('reads each h3 of a faq as a question and the paragraphs after it as its answer', () => {
    const document = {
      nodes: [
        ['p', {}, 'Before.'],
        [
          'faq',
          {},
          [
            'template',
            { name: 'default' },
            ['h3', { id: 'a' }, 'Is it ', ['code', {}, 'MIT'], '?'],
            ['p', {}, 'Yes.'],
            ['p', {}, 'All of it.'],
            ['h3', { id: 'b' }, 'Empty?'],
            ['h3', { id: 'c' }, 'Where?'],
            ['p', {}, 'In  your\naccount.'],
          ],
        ],
      ],
    }
    expect(faqOf(document)).toEqual([
      { question: 'Is it MIT?', answer: 'Yes. All of it.' },
      { question: 'Where?', answer: 'In your account.' },
    ])
    expect(faqOf({ nodes: [['p', {}, 'No faq']] })).toEqual([])
    expect(faqOf(null)).toEqual([])
  })
})
