import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod'

import { defineCollection } from '../../src/config/define.ts'
import { contracts } from '../../src/contracts/index.ts'
import { collectionOf, fakeEntries, markdownOf, run } from './support.ts'

// Fails when: `contracts.custom` stops returning a contract with the id, severity, description and
// phases it is given (and no phases when it is given none); stops passing when `check` answers true
// or reporting one finding when it answers false, also when `check` answers with a promise; stops
// using the message, the fix and the path it is given, as a text or as a function of the context,
// or the whole entry (the empty pointer) when it has no path; stops giving `check` what the schema
// returned; or the factories stop fitting inside `defineCollection` (type errors under `vp check`).

const titleSchema = z.object({ title: z.string(), cta: z.enum(['a', 'b']).default('a') })

function titleLength(severity: 'error' | 'warning' = 'warning') {
  return contracts.custom<{ title: string }>({
    id: 'seo-title-length',
    severity,
    description: 'A title of at most 20 characters.',
    check: ({ frontmatter }) => frontmatter.title.length <= 20,
    message: ({ frontmatter }) => `The title has ${frontmatter.title.length} characters.`,
    fix: 'Shorten the title to 20 characters or fewer.',
    path: '/frontmatter/title',
  })
}

function runWithTitle(title: string, contract = titleLength()) {
  return run({
    collection: collectionOf({ schema: titleSchema, contracts: [contract] }),
    markdown: markdownOf({ frontmatter: { title } }),
  })
}

describe('contracts.custom', () => {
  it('makes a contract with the id, severity, description and phases it is given', () => {
    const contract = contracts.custom({
      id: 'only-on-publish',
      severity: 'error',
      description: 'It runs when publishing.',
      phases: ['publish'],
      check: () => true,
      message: 'm',
      fix: 'f',
    })
    expect(contract.id).toBe('only-on-publish')
    expect(contract.severity).toBe('error')
    expect(contract.description).toBe('It runs when publishing.')
    expect(contract.phases).toStrictEqual(['publish'])
  })

  it('leaves the phases out when it is given none, so that the contract runs in both', () => {
    const contract = contracts.custom({
      id: 'always',
      severity: 'error',
      description: 'It always runs.',
      check: () => true,
      message: 'm',
      fix: 'f',
    })
    expect('phases' in contract).toBe(false)
  })

  it('passes when check answers true', async () => {
    const verdict = await runWithTitle('Short')
    expect(verdict.errors).toStrictEqual([])
    expect(verdict.warnings).toStrictEqual([])
    expect(verdict.ok).toBe(true)
  })

  it('reports one finding when check answers false, with the message, fix and path it was given', async () => {
    const verdict = await runWithTitle('A title that is far too long')
    expect(verdict.warnings).toStrictEqual([
      {
        contract: 'seo-title-length',
        severity: 'warning',
        path: '/frontmatter/title',
        message: 'The title has 28 characters.',
        fix: 'Shorten the title to 20 characters or fewer.',
      },
    ])
    expect(verdict.errors).toStrictEqual([])
    expect(verdict.ok).toBe(true)
  })

  it('is an error when it is given that severity', async () => {
    const verdict = await runWithTitle('A title that is far too long', titleLength('error'))
    expect(verdict.errors.map((violation) => violation.contract)).toStrictEqual([
      'seo-title-length',
    ])
    expect(verdict.ok).toBe(false)
  })

  it('points at the whole entry when it has no path, and takes a message and a fix as plain text', async () => {
    const contract = contracts.custom({
      id: 'always-fails',
      severity: 'error',
      description: 'Never passes.',
      check: () => false,
      message: 'This never passes.',
      fix: 'Change something.',
    })
    const verdict = await run({ collection: collectionOf({ contracts: [contract] }) })
    expect(verdict.errors).toStrictEqual([
      {
        contract: 'always-fails',
        severity: 'error',
        path: '',
        message: 'This never passes.',
        fix: 'Change something.',
      },
    ])
  })

  it('takes the fix as a function of the context too', async () => {
    const contract = contracts.custom<{ title: string }>({
      id: 'title-room',
      severity: 'warning',
      description: 'Room in the title.',
      check: ({ frontmatter }) => frontmatter.title.length <= 5,
      message: 'The title is long.',
      fix: ({ frontmatter, slug }) =>
        `Cut ${frontmatter.title.length - 5} characters from the title of ${slug}.`,
      path: '/frontmatter/title',
    })
    const verdict = await run({
      collection: collectionOf({ schema: titleSchema, contracts: [contract] }),
      slug: 'a-slug',
      markdown: markdownOf({ frontmatter: { title: 'Seven c' } }),
    })
    expect(verdict.warnings.map((violation) => violation.fix)).toStrictEqual([
      'Cut 2 characters from the title of a-slug.',
    ])
  })

  it('waits for a check that answers with a promise', async () => {
    const { lookup, calls } = fakeEntries()
    const contract = contracts.custom({
      id: 'asks-the-store',
      severity: 'error',
      description: 'Looks something up.',
      check: async ({ entries }) => {
        const [found] = await entries.lookupMany([
          { collection: 'blog', locale: 'es', slug: 'edge-caching-guide' },
        ])
        return found !== null
      },
      message: 'The entry does not exist yet.',
      fix: 'Create it.',
    })
    const verdict = await run({
      collection: collectionOf({ contracts: [contract] }),
      entries: lookup,
    })
    expect(calls).toHaveLength(1)
    expect(verdict.errors.map((violation) => violation.message)).toStrictEqual([
      'The entry does not exist yet.',
    ])
  })

  it('gives check what the schema returned, not the raw frontmatter', async () => {
    const seen: unknown[] = []
    const contract = contracts.custom<{ cta: string }>({
      id: 'sees-the-default',
      severity: 'warning',
      description: 'Reads cta.',
      check: ({ frontmatter }) => {
        seen.push(frontmatter.cta)
        return true
      },
      message: 'm',
      fix: 'f',
    })
    await run({
      collection: collectionOf({ schema: titleSchema, contracts: [contract] }),
      markdown: markdownOf({ frontmatter: { title: 'A' } }),
    })
    expect(seen).toStrictEqual(['a'])
  })
})

describe('the contracts namespace', () => {
  it('has the three built-in factories and custom', () => {
    expect(Object.keys(contracts).toSorted()).toStrictEqual([
      'custom',
      'imagesHaveAlt',
      'internalLinksResolve',
      'translationPair',
    ])
  })

  it('fits inside defineCollection, with the frontmatter type given to custom', () => {
    const collection = defineCollection({
      schema: z.object({ title: z.string() }),
      routes: { en: '/blog/:slug/' },
      translations: { groupBy: 'title' },
      contracts: [
        contracts.translationPair(),
        contracts.internalLinksResolve(),
        contracts.imagesHaveAlt({ severity: 'warning' }),
        contracts.custom<{ title: string }>({
          id: 'seo-title-length',
          severity: 'warning',
          description: 'A title of at most 60 characters.',
          check: ({ frontmatter }) => frontmatter.title.length <= 60,
          message: 'The title is long.',
          fix: 'Shorten the title.',
        }),
      ],
    })
    expect(collection.contracts?.map((contract) => [contract.id, contract.severity])).toStrictEqual(
      [
        ['translation-pair', 'error'],
        ['internal-links-resolve', 'error'],
        ['images-have-alt', 'warning'],
        ['seo-title-length', 'warning'],
      ],
    )
  })
})
