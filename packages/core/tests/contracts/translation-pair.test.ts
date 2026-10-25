import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod'

import { contracts, type Severity } from '../../src/contracts/index.ts'
import {
  collectionOf,
  fakeEntries,
  markdownOf,
  run,
  type RunParts,
  stored,
  type StoredEntry,
} from './support.ts'

const GROUP = 'edge-caching-guide'

function violation(locale: string, field = 'translationGroup', group = GROUP) {
  return {
    contract: 'translation-pair',
    severity: 'error',
    path: `/frontmatter/${field}`,
    message: `The ${locale} version of the translation group "${group}" does not exist.`,
    fix: `Create the entry in ${locale} with ${field}: "${group}" in its frontmatter before publishing.`,
    code: 'translation-pair.missing',
    params: { field, group, locale },
  }
}

interface PairParts extends RunParts {
  readonly severity?: Severity
}

async function runPair(stores: readonly StoredEntry[], { severity, ...parts }: PairParts = {}) {
  const { lookup, calls } = fakeEntries(stores)
  const verdict = await run({
    phase: 'publish',
    collection: collectionOf({
      translationGroupField: 'translationGroup',
      contracts: [contracts.translationPair(severity === undefined ? {} : { severity })],
    }),
    entries: lookup,
    ...parts,
  })
  return { verdict, calls }
}

describe('the translation-pair contract', () => {
  it('passes when every locale of the site has an entry in the group, in any status', async () => {
    const { verdict, calls } = await runPair([
      stored('es', 'edge-caching-guide', 'published', GROUP),
      stored('en', 'edge-caching-guide', 'draft', GROUP),
    ])
    expect(verdict.errors).toStrictEqual([])
    expect(verdict.ok).toBe(true)
    expect(calls).toStrictEqual([
      { method: 'translations', collection: 'blog', translationGroup: GROUP },
    ])
  })

  it('names the locale that has no entry in the group, and the group', async () => {
    const { verdict } = await runPair([stored('es', 'edge-caching-guide', 'draft', GROUP)])
    expect(verdict.errors).toStrictEqual([violation('en')])
    expect(verdict.ok).toBe(false)
  })

  it('counts the entry being checked even when the store has no row for it yet', async () => {
    const { verdict } = await runPair([])
    expect(verdict.errors).toStrictEqual([violation('en')])
  })

  it('reports each missing locale, in the order of the site', async () => {
    const { verdict } = await runPair([], {
      locales: ['es', 'en', 'pt', 'fr'],
      locale: 'en',
    })
    expect(verdict.errors).toStrictEqual([violation('es'), violation('pt'), violation('fr')])
  })

  it('takes the group from the field the collection names, and points at it', async () => {
    const { lookup, calls } = fakeEntries([])
    const verdict = await run({
      phase: 'publish',
      collection: collectionOf({
        schema: z.object({ title: z.string(), key: z.string() }),
        translationGroupField: 'key',
        contracts: [contracts.translationPair()],
      }),
      markdown: markdownOf({ frontmatter: { title: 'A', key: 'the-key' } }),
      entries: lookup,
    })
    expect(verdict.errors).toStrictEqual([violation('en', 'key', 'the-key')])
    expect(calls).toStrictEqual([
      { method: 'translations', collection: 'blog', translationGroup: 'the-key' },
    ])
  })

  it('reports an entry that has no group, and does not ask the store', async () => {
    const { verdict, calls } = await runPair([], {
      markdown: markdownOf({ frontmatter: { title: 'A', description: 'B', tags: ['x'] } }),
    })
    expect(verdict.errors).toStrictEqual([
      {
        contract: 'translation-pair',
        severity: 'error',
        path: '/frontmatter/translationGroup',
        message:
          'The entry has no translation group: its frontmatter field translationGroup is empty.',
        fix: 'Set translationGroup in the frontmatter to the key that all the translations of this entry share, then create the entries for the locales of the site: es, en.',
        code: 'translation-pair.no-group',
        params: { field: 'translationGroup', locales: 'es, en' },
      },
    ])
    expect(calls).toStrictEqual([])
  })

  it('counts an empty group as none, for a schema that lets it through', async () => {
    const { lookup, calls } = fakeEntries([])
    const verdict = await run({
      phase: 'publish',
      collection: collectionOf({
        schema: z.object({ translationGroup: z.string() }),
        translationGroupField: 'translationGroup',
        contracts: [contracts.translationPair()],
      }),
      markdown: markdownOf({ frontmatter: { translationGroup: '' } }),
      entries: lookup,
    })
    expect(verdict.errors.map((violation) => violation.message)).toStrictEqual([
      'The entry has no translation group: its frontmatter field translationGroup is empty.',
    ])
    expect(calls).toStrictEqual([])
  })

  it('does not run in the write phase, and asks the store nothing', async () => {
    const { lookup, calls } = fakeEntries([])
    const verdict = await run({
      phase: 'write',
      collection: collectionOf({
        translationGroupField: 'translationGroup',
        contracts: [contracts.translationPair()],
      }),
      entries: lookup,
    })
    expect(verdict.errors).toStrictEqual([])
    expect(calls).toStrictEqual([])
  })

  it('is skipped when the collection has no translations', async () => {
    const { lookup, calls } = fakeEntries([])
    const verdict = await run({
      phase: 'publish',
      collection: collectionOf({ contracts: [contracts.translationPair()] }),
      entries: lookup,
    })
    expect(verdict.errors).toStrictEqual([])
    expect(calls).toStrictEqual([])
  })

  it('is skipped while the frontmatter does not pass the schema, which it reads', async () => {
    const { verdict, calls } = await runPair([], {
      markdown: markdownOf({ frontmatter: { title: '' } }),
    })
    expect(verdict.errors.map((error) => error.contract)).toStrictEqual([
      'schema',
      'schema',
      'schema',
    ])
    expect(calls).toStrictEqual([])
  })

  it('is a warning when it is given that severity', async () => {
    const { verdict } = await runPair([], { severity: 'warning' })
    expect(verdict.errors).toStrictEqual([])
    expect(verdict.warnings).toStrictEqual([{ ...violation('en'), severity: 'warning' }])
    expect(verdict.ok).toBe(true)
  })
})
