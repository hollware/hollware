import { HollwareError, type EntryLookup, type Verdict } from '@hollware/core'
import type { PublishWrite, UnpublishWrite } from '../ports.ts'
import { actorOf } from './actor.ts'
import {
  conflictAt,
  entrySummary,
  refusalVerdict,
  verdictView,
  type EntrySummary,
} from './answers.ts'
import { collectionOfEntry } from './collections.ts'
import { judge, processFor, sortKeyOf } from './draft.ts'
import { eventFor } from './event.ts'
import type { OperationContext } from './types.ts'

export interface Member {
  readonly id: string
  readonly version?: number
  readonly revision?: string | null
}

export interface Checked {
  readonly summary: EntrySummary
  readonly collection: ReturnType<typeof collectionOfEntry>
  readonly verdict: Verdict
  readonly write: PublishWrite
}

export function warningKey(warning: { readonly contract: string; readonly path: string }): string {
  return JSON.stringify([warning.contract, warning.path])
}

export function distinctMembers<Item extends { readonly id: string }>(
  items: readonly Item[],
): Item[] {
  return items.filter((item, index) => items.findIndex((other) => other.id === item.id) === index)
}

export function refuseOverlap(publish: readonly Member[], unpublish: readonly Member[]): void {
  const both = unpublish.find((member) => publish.some((other) => other.id === member.id))
  if (both !== undefined) {
    throw new HollwareError(
      'invalid_input',
      `The entry ${both.id} is asked to be published and unpublished in the same review.`,
      'Name each entry once: in id or group to publish it, or in unpublish to take it off the site.',
    )
  }
}

function lookupFor(
  lookup: EntryLookup,
  published: ReadonlySet<string>,
  unpublished: ReadonlySet<string>,
): EntryLookup {
  return {
    lookupMany: async (refs) =>
      (await lookup.lookupMany(refs)).map((facts) => {
        if (facts === null) return null
        if (published.has(facts.id)) return { ...facts, status: 'published' }
        if (unpublished.has(facts.id)) return { ...facts, status: 'draft' }
        return facts
      }),
    translations: (collection, group) => lookup.translations(collection, group),
  }
}

function moved(
  current: { readonly version: number; readonly headRevision: string },
  failedEntry: string,
) {
  return {
    outcome: 'conflict' as const,
    conflict: conflictAt(current.version, current.headRevision),
    failedEntry,
  }
}

export async function checkChangeset(
  context: OperationContext,
  input: {
    readonly publish: readonly Member[]
    readonly unpublish: readonly Member[]
    readonly acknowledgeWarnings: readonly { readonly contract: string; readonly path: string }[]
  },
) {
  const site = context.site.key
  const actor = actorOf(context)
  const now = context.clock.now().toISOString()
  const lookup = lookupFor(
    context.store.lookup(site),
    new Set(input.publish.map((member) => member.id)),
    new Set(input.unpublish.map((member) => member.id)),
  )
  const unpublishes: UnpublishWrite[] = []
  for (const member of input.unpublish) {
    const found = await context.store.findEntryById(site, member.id, 'head')
    if (found === null) return { outcome: 'not_found' as const, failedEntry: member.id }
    const { entry } = found
    if (
      (member.version !== undefined && entry.version !== member.version) ||
      entry.status !== 'published' ||
      (member.revision !== undefined && entry.publishedRevision !== member.revision)
    ) {
      return moved(entry, member.id)
    }
    unpublishes.push({
      entryId: entry.id,
      expectedVersion: entry.version,
      actor,
      event: eventFor({
        kind: 'entry.unpublished',
        site: context.site,
        collection: collectionOfEntry(context.site, entry),
        entry: {
          id: entry.id,
          collection: entry.collection,
          locale: entry.locale,
          slug: entry.slug,
          translationGroup: entry.translationGroup,
        },
        at: now,
      }),
    })
  }
  const checked: Checked[] = []
  for (const member of input.publish) {
    const found = await context.store.findEntryById(site, member.id, 'head')
    if (found === null) return { outcome: 'not_found' as const, failedEntry: member.id }
    const { entry, revision } = found
    if (
      (member.version !== undefined && entry.version !== member.version) ||
      (member.revision !== undefined && entry.headRevision !== member.revision)
    ) {
      return moved(entry, member.id)
    }
    const collection = collectionOfEntry(context.site, entry)
    const summary = entrySummary(found)
    const processed = await processFor(context.site, collection, revision.markdown)
    if (!processed.ok) {
      return {
        outcome: 'blocked' as const,
        entry: summary,
        verdict: refusalVerdict('publish', processed.violations),
        failedEntry: member.id,
      }
    }
    const verdict = await judge(
      context,
      collection,
      { locale: entry.locale, slug: entry.slug, entryId: entry.id },
      processed.value,
      'publish',
      lookup,
    )
    if (!verdict.ok) {
      return {
        outcome: 'blocked' as const,
        entry: summary,
        verdict: verdictView(verdict),
        failedEntry: member.id,
      }
    }
    checked.push({
      summary,
      collection,
      verdict,
      write: {
        event: eventFor({
          kind: 'entry.published',
          site: context.site,
          collection,
          entry: {
            id: entry.id,
            collection: entry.collection,
            locale: entry.locale,
            slug: entry.slug,
            translationGroup: entry.translationGroup,
          },
          at: now,
        }),
        entryId: entry.id,
        expectedVersion: entry.version,
        verdict,
        acknowledged: verdict.warnings.map(({ contract, path }) => ({ contract, path })),
        actor,
        sortKey: sortKeyOf(collection, processed.value.frontmatter) ?? entry.publishedAt ?? now,
      },
    })
  }
  const acknowledged = new Set(input.acknowledgeWarnings.map(warningKey))
  const pending = checked.find(({ verdict }) =>
    verdict.warnings.some((warning) => !acknowledged.has(warningKey(warning))),
  )
  if (pending !== undefined) {
    return {
      outcome: 'needs_acknowledgement' as const,
      entry: pending.summary,
      verdict: verdictView(pending.verdict),
      failedEntry: pending.write.entryId,
    }
  }
  return { outcome: 'checked' as const, checked, unpublishes }
}
