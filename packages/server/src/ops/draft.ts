import {
  processMarkdown,
  type EntryLookup,
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

/**
 * What the operations that take Markdown share: running the pipeline and the contracts of a
 * collection on it, and reading from the frontmatter that the pipeline returned the fields that
 * the store keeps beside the revision.
 */

/**
 * What the pipeline needs of a site and a collection: the components the collection allows, the
 * largest file it accepts, and the routes of every collection of the site, by collection name, so
 * that a link to another collection's entry is recognized.
 */
function optionsFor(site: ResolvedSite, collection: ResolvedCollection): ProcessMarkdownOptions {
  return {
    components: [...collection.components.keys()],
    maxMarkdownBytes: collection.maxMarkdownBytes,
    routes: Object.fromEntries([...site.collections].map(([name, other]) => [name, other.routes])),
  }
}

/** Runs the Markdown pipeline on a file for a collection. It never throws; see `processMarkdown`. */
export function processFor(
  site: ResolvedSite,
  collection: ResolvedCollection,
  markdown: string,
): Promise<ProcessResult> {
  return processMarkdown(markdown, optionsFor(site, collection))
}

/** The entry that a file is checked as: where it lives, and its id when it already exists. */
export interface Target {
  readonly locale: string
  readonly slug: string
  /** `null` while the entry is being created, so that the contracts know it has no row yet. */
  readonly entryId: string | null
}

/**
 * Runs the contracts of a collection on a file the pipeline accepted. `write` is what a draft is
 * saved under; `publish` is what `validate` and `publish` check, with every contract of the
 * collection, against the other entries of the site as they are now.
 */
export function judge(
  context: OperationContext,
  collection: ResolvedCollection,
  target: Target,
  markdown: ProcessedMarkdown,
  phase: Phase,
  /** What the contracts see of the other entries; the store's own view when absent. */
  entries: EntryLookup = context.store.lookup(context.site.key),
): Promise<Verdict> {
  return runContracts({
    site: context.site,
    collection,
    locale: target.locale,
    slug: target.slug,
    entryId: target.entryId,
    phase,
    markdown,
    entries,
  })
}

type Frontmatter = Readonly<Record<string, unknown>>

/**
 * The key that the translations of an entry share: the value of the field that the collection
 * names, when it is a string. An empty string is no key: `get_translations` never takes one, and
 * the `translation-pair` contract reads it as a missing group, so it is stored as none, which
 * also keeps two drafts with an empty group from refusing one another.
 */
export function translationGroupOf(
  collection: ResolvedCollection,
  frontmatter: Frontmatter,
): string | null {
  const field = collection.translationGroupField
  const value = field === null ? undefined : frontmatter[field]
  return typeof value === 'string' && value !== '' ? value : null
}

/** The tags of an entry: the value of the field that the collection names, when it is a list of strings. */
export function tagsOf(collection: ResolvedCollection, frontmatter: Frontmatter): string[] {
  const field = collection.tagsField
  const value = field === null ? undefined : frontmatter[field]
  return Array.isArray(value) && value.every((tag): tag is string => typeof tag === 'string')
    ? value
    : []
}

/** What orders the entry in published listings: the value of the sorting field, when it is a string. */
export function sortKeyOf(collection: ResolvedCollection, frontmatter: Frontmatter): string | null {
  const field = collection.sortByField
  const value = field === null ? undefined : frontmatter[field]
  return typeof value === 'string' ? value : null
}

/**
 * The revision to store for a file. The Markdown is exactly the file the caller sent: its bytes
 * are the source of truth, and everything else is derived from them (ADR-001).
 */
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
