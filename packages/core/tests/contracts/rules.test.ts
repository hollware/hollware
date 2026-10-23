import { describe, expect, it } from 'vite-plus/test'
import { contracts } from '../../src/contracts/index.ts'
import * as z from 'zod'
import type { ProcessedMarkdown } from '../../src/markdown/types.ts'
import { blogSchema, collectionOf, markdownOf, run, FRONTMATTER } from './support.ts'

const titled = (title: string, extra: Record<string, unknown> = {}) =>
  markdownOf({ frontmatter: { ...FRONTMATTER, title, ...extra } })

describe('field-length', () => {
  const collection = collectionOf({
    schema: blogSchema.extend({ seoTitle: z.string().optional() }),
    contracts: [
      contracts.fieldLength(
        { field: 'title', max: 5, unless: 'seoTitle' },
        { severity: 'warning' },
      ),
    ],
  })

  it('finds a text over its max, and lets it be with the field of unless', async () => {
    const verdict = await run({ collection, markdown: titled('Edge caching') })
    expect(verdict.warnings).toEqual([
      {
        contract: 'field-length',
        severity: 'warning',
        path: '/frontmatter/title',
        message: '"title" has 12 characters; the most is 5.',
        fix: 'Shorten "title" to 5 characters or fewer, or add "seoTitle".',
      },
    ])
    expect(
      (await run({ collection, markdown: titled('Edge caching', { seoTitle: 'Edge' }) })).warnings,
    ).toEqual([])
  })

  it('counts an emoji as one character, and items of a list', async () => {
    expect(
      (await run({ collection, markdown: titled('\u{1F469}\u200D\u{1F469}\u200D\u{1F467}abcd') }))
        .warnings,
    ).toEqual([])
    const tags = collectionOf({ contracts: [contracts.fieldLength({ field: 'tags', min: 2 })] })
    expect((await run({ collection: tags })).errors.map((error) => error.message)).toEqual([
      '"tags" has 1 item; the least is 2.',
    ])
  })
})

describe('field-pattern', () => {
  it('finds a text that does not match as a whole', async () => {
    const collection = collectionOf({
      contracts: [
        contracts.fieldPattern({
          field: 'title',
          pattern: '[A-Z][a-z ]+',
          description: 'a capitalized phrase',
        }),
      ],
    })
    expect((await run({ collection, markdown: titled('Edge caching') })).errors).toEqual([])
    expect(
      (await run({ collection, markdown: titled('Edge caching!') })).errors.map(
        (error) => error.fix,
      ),
    ).toEqual(['Write "title" as a capitalized phrase.'])
  })
})

describe('required-to-publish', () => {
  const collection = collectionOf({
    contracts: [contracts.requiredToPublish({ fields: ['description', 'translationGroup'] })],
  })
  const markdown = markdownOf({
    frontmatter: { ...FRONTMATTER, description: ' ', translationGroup: undefined },
  })

  it('finds empty fields when publishing, and not before', async () => {
    expect((await run({ collection, markdown, phase: 'write' })).errors).toEqual([])
    expect(
      (await run({ collection, markdown, phase: 'publish' })).errors.map((error) => error.path),
    ).toEqual(['/frontmatter/description', '/frontmatter/translationGroup'])
  })
})

describe('banned-words', () => {
  const collection = collectionOf({
    contracts: [contracts.bannedWords({ words: ['holloware'], reason: 'the brand is Hollware' })],
  })

  it('finds a word in a text field and in the body, whole and in any case', async () => {
    const markdown: ProcessedMarkdown = {
      ...titled('Why Holloware?'),
      document: {
        nodes: [['p', {}, 'Use holloware today, not hollowares.']],
        frontmatter: {},
        meta: {},
      },
    }
    expect((await run({ collection, markdown })).errors).toEqual([
      {
        contract: 'banned-words',
        severity: 'error',
        path: '/body',
        message: 'The body uses "holloware".',
        fix: 'Rewrite the body without "holloware" (the brand is Hollware).',
      },
      {
        contract: 'banned-words',
        severity: 'error',
        path: '/frontmatter/title',
        message: '"title" uses "Holloware".',
        fix: 'Write "title" without "Holloware" (the brand is Hollware).',
      },
    ])
  })
})
