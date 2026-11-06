import {
  formatMarkdown,
  type FormattedMarkdown,
  processMarkdown,
  type EntryLookup,
  parentViolation,
  runContracts,
  type Phase,
  type ProcessedMarkdown,
  type ProcessMarkdownOptions,
  type ProcessResult,
  type ResolvedCollection,
  type ResolvedSite,
  type Verdict,
} from '@hollware/core'
import type { Actor, NewRevision } from '../ports.ts'
import type { OperationContext } from './types.ts'

function optionsFor(site: ResolvedSite, collection: ResolvedCollection): ProcessMarkdownOptions {
  return {
    components: [...collection.components.keys()],
    maxMarkdownBytes: collection.maxMarkdownBytes,
    routes: Object.fromEntries([...site.collections].map(([name, other]) => [name, other.routes])),
    depths: Object.fromEntries(
      [...site.collections].flatMap(([name, other]) =>
        other.nesting === null ? [] : [[name, other.nesting.maxDepth]],
      ),
    ),
  }
}

export function processFor(
  site: ResolvedSite,
  collection: ResolvedCollection,
  markdown: string,
): Promise<ProcessResult> {
  return processMarkdown(markdown, optionsFor(site, collection))
}

export function formatFor(
  site: ResolvedSite,
  collection: ResolvedCollection,
  markdown: string,
): Promise<FormattedMarkdown> {
  return formatMarkdown(markdown, optionsFor(site, collection))
}

export interface Target {
  readonly locale: string
  readonly slug: string
  readonly entryId: string | null
  readonly slugPath?: string
}

async function unpublishedAncestor(
  collection: ResolvedCollection,
  target: Target,
  entries: EntryLookup,
): Promise<string | null> {
  const ancestors = (target.slugPath ?? target.slug).split('/').slice(0, -1)
  if (collection.nesting === null || ancestors.length === 0) return null
  const found = await entries.lookupMany(
    ancestors.map((slug) => ({ collection: collection.name, locale: target.locale, slug })),
  )
  const index = found.findIndex((facts) => facts === null || facts.status !== 'published')
  return index === -1 ? null : (ancestors[index] ?? null)
}

export async function judge(
  context: OperationContext,
  collection: ResolvedCollection,
  target: Target,
  markdown: ProcessedMarkdown,
  phase: Phase,
  entries: EntryLookup = context.store.lookup(context.site.key),
): Promise<Verdict> {
  const verdict = await runContracts({
    site: context.site,
    collection,
    locale: target.locale,
    slug: target.slug,
    entryId: target.entryId,
    phase,
    markdown,
    entries,
  })
  const parent = phase === 'publish' ? await unpublishedAncestor(collection, target, entries) : null
  if (parent === null) return verdict
  return {
    ...verdict,
    ok: false,
    errors: [
      ...verdict.errors,
      parentViolation('unpublished', {
        parent,
        maxDepth: collection.nesting?.maxDepth ?? null,
      }),
    ],
  }
}

type Frontmatter = Readonly<Record<string, unknown>>

export function translationGroupOf(
  collection: ResolvedCollection,
  frontmatter: Frontmatter,
): string | null {
  const field = collection.translationGroupField
  const value = field === null ? undefined : frontmatter[field]
  return typeof value === 'string' && value !== '' ? value : null
}

export function tagsOf(collection: ResolvedCollection, frontmatter: Frontmatter): string[] {
  const field = collection.tagsField
  const value = field === null ? undefined : frontmatter[field]
  return Array.isArray(value) && value.every((tag): tag is string => typeof tag === 'string')
    ? value
    : []
}

export function sortKeyOf(collection: ResolvedCollection, frontmatter: Frontmatter): string | null {
  const field = collection.sortByField
  const value = field === null ? undefined : frontmatter[field]
  return typeof value === 'string' ? value : null
}

export function revisionOf(input: {
  readonly markdown: string
  readonly processed: ProcessedMarkdown
  readonly collection: ResolvedCollection
  readonly verdict: Verdict
  readonly actor: Actor
}): NewRevision {
  const { processed } = input
  return {
    markdown: input.markdown,
    frontmatter: processed.frontmatter,
    document: processed.document,
    comarkVersion: processed.comarkVersion,
    pipelineVersion: processed.pipelineVersion,
    wordCount: processed.extracted.words,
    codeWords: processed.extracted.codeWords,
    verdict: input.verdict,
    tags: tagsOf(input.collection, processed.frontmatter),
    actor: input.actor,
  }
}
