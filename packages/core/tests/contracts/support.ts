import * as z from 'zod'

import type {
  ComponentDefinition,
  DescribedSchema,
  ResolvedCollection,
  ResolvedSite,
} from '../../src/config/types.ts'
import { runContracts } from '../../src/contracts/index.ts'
import type {
  Contract,
  EntryFacts,
  EntryLookup,
  EntryRef,
  Phase,
  Verdict,
} from '../../src/contracts/index.ts'
import type {
  ComponentUse,
  DisallowedMarker,
  ImageRef,
  LinkRef,
  ProcessedMarkdown,
} from '../../src/markdown/types.ts'

/**
 * What the tests of the contracts stand on: a collection and a site as the config resolves them,
 * the Markdown pipeline's answer written by hand (the pipeline is another package of the work),
 * and an in-memory `EntryLookup`, the port the server implements on D1, that records its calls.
 */

export const ENTRY_ID = 'ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW'

/** A frontmatter that the default schema accepts. */
export const FRONTMATTER = {
  title: 'Edge caching guide',
  description: 'How to cache at the edge.',
  tags: ['cloudflare'],
  translationGroup: 'edge-caching-guide',
}

/** The default schema of the tests' collection: a blog whose translation group is optional. */
export const blogSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).max(160),
  tags: z.array(z.string().min(1)).min(1),
  translationGroup: z.string().min(1).optional(),
})

/** What a hand-made schema was asked for. */
export interface ConversionLog {
  /** The targets of the calls to its input JSON Schema. */
  readonly inputTargets: string[]
  /** The targets of the calls to its output JSON Schema. */
  readonly outputTargets: string[]
}

export function conversionLog(): ConversionLog {
  return { inputTargets: [], outputTargets: [] }
}

/**
 * A Standard Schema with JSON Schema made by hand: it accepts any value and says it is `json` as
 * an input and `json` with a description of `output` as an output, so that a test can tell which of
 * the two a caller asked for. `log` records how it was asked.
 */
export function described(
  json: Readonly<Record<string, unknown>>,
  log: ConversionLog = conversionLog(),
): DescribedSchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) => ({ value }),
      jsonSchema: {
        input: ({ target }) => {
          log.inputTargets.push(target)
          return { ...json }
        },
        output: ({ target }) => {
          log.outputTargets.push(target)
          return { ...json, description: 'output' }
        },
      },
    },
  }
}

export interface CollectionParts {
  readonly schema?: DescribedSchema
  readonly components?: Readonly<Record<string, ComponentDefinition>>
  readonly contracts?: readonly Contract<unknown>[]
  /** The frontmatter field of the translation group; the collection has no translations by default. */
  readonly translationGroupField?: string
}

export function collectionOf(parts: CollectionParts = {}): ResolvedCollection {
  return {
    name: 'blog',
    schema: parts.schema ?? blogSchema,
    routes: { es: '/blog/:slug/', en: '/en/blog/:slug/' },
    translationGroupField: parts.translationGroupField ?? null,
    tagsField: 'tags',
    sortByField: null,
    components: new Map(Object.entries(parts.components ?? {})),
    contracts: parts.contracts ?? [],
    maxMarkdownBytes: 524_288,
    styleGuide: null,
  }
}

export function siteOf(
  collection: ResolvedCollection,
  locales: readonly string[] = ['es', 'en'],
): ResolvedSite {
  return {
    key: 'acme',
    locales,
    defaultLocale: locales[0] ?? 'es',
    styleGuide: null,
    collections: new Map([[collection.name, collection]]),
    url: null,
    cors: { origins: [] },
    events: { webhooks: [], indexNow: null },
    audit: { ipAddresses: 'off', retentionDays: null },
    media: { format: 'webp', quality: 85, maxWidth: 2400 },
  }
}

export interface MarkdownParts {
  readonly frontmatter?: Readonly<Record<string, unknown>>
  readonly links?: readonly LinkRef[]
  readonly images?: readonly ImageRef[]
  readonly components?: readonly ComponentUse[]
  readonly disallowed?: readonly DisallowedMarker[]
}

/** What the pipeline would answer for a file, with only the parts a test cares about. */
export function markdownOf(parts: MarkdownParts = {}): ProcessedMarkdown {
  return {
    frontmatter: parts.frontmatter ?? FRONTMATTER,
    document: { nodes: [], frontmatter: {}, meta: {} },
    extracted: {
      headings: [],
      links: parts.links ?? [],
      images: parts.images ?? [],
      components: parts.components ?? [],
      words: 0,
      disallowed: parts.disallowed ?? [],
    },
    comarkVersion: '0.7.0',
    pipelineVersion: 'test',
  }
}

/** A lookup that a test does not expect to be called: it throws. */
export const NO_LOOKUPS: EntryLookup = {
  lookupMany: () => Promise.reject(new Error('this test expects no lookupMany')),
  translations: () => Promise.reject(new Error('this test expects no translations lookup')),
}

export interface RunParts {
  readonly collection?: ResolvedCollection
  readonly locales?: readonly string[]
  readonly locale?: string
  readonly slug?: string
  readonly entryId?: string | null
  readonly phase?: Phase
  readonly markdown?: ProcessedMarkdown
  readonly entries?: EntryLookup
}

/** Runs the contracts of a collection on an `es` entry of the blog, in the `write` phase by default. */
export function run(parts: RunParts = {}): Promise<Verdict> {
  const collection = parts.collection ?? collectionOf()
  return runContracts({
    site: siteOf(collection, parts.locales),
    collection,
    locale: parts.locale ?? 'es',
    slug: parts.slug ?? 'edge-caching-guide',
    entryId: parts.entryId === undefined ? ENTRY_ID : parts.entryId,
    phase: parts.phase ?? 'write',
    markdown: parts.markdown ?? markdownOf(),
    entries: parts.entries ?? NO_LOOKUPS,
  })
}

export interface StoredEntry extends EntryRef, EntryFacts {}

/** An entry of the blog as the store holds it. */
export function stored(
  locale: string,
  slug: string,
  status: EntryFacts['status'] = 'published',
  translationGroup: string | null = null,
): StoredEntry {
  return {
    collection: 'blog',
    locale,
    slug,
    id: `ent_${locale}_${slug}`,
    status,
    translationGroup,
  }
}

export type LookupCall =
  | { readonly method: 'lookupMany'; readonly refs: readonly EntryRef[] }
  | {
      readonly method: 'translations'
      readonly collection: string
      readonly translationGroup: string
    }

/** An in-memory `EntryLookup` over the given entries that records every call it gets. */
export function fakeEntries(entries: readonly StoredEntry[] = []): {
  readonly lookup: EntryLookup
  readonly calls: LookupCall[]
} {
  const calls: LookupCall[] = []
  const lookup: EntryLookup = {
    lookupMany(refs) {
      calls.push({ method: 'lookupMany', refs })
      return Promise.resolve(
        refs.map((ref) => {
          const found = entries.find(
            (entry) =>
              entry.collection === ref.collection &&
              entry.locale === ref.locale &&
              entry.slug === ref.slug,
          )
          return found === undefined
            ? null
            : { id: found.id, status: found.status, translationGroup: found.translationGroup }
        }),
      )
    },
    translations(collection, translationGroup) {
      calls.push({ method: 'translations', collection, translationGroup })
      return Promise.resolve(
        entries.filter(
          (entry) => entry.collection === collection && entry.translationGroup === translationGroup,
        ),
      )
    },
  }
  return { lookup, calls }
}
