import { HollwareError, type OperationByName, type Scope } from '@hollware/core'
import type * as z from 'zod'
import type { StoredRedirect } from '../ports.ts'
import { conflictAt, entrySummary } from './answers.ts'
import { cursorOf, parseCursor } from './assets.ts'
import { collectionOfEntry } from './collections.ts'
import { entryPath, eventFor } from './event.ts'
import type { OperationContext, OperationHandler } from './types.ts'

type RedirectView = z.output<OperationByName<'list_redirects'>['output']>['redirects'][number]

/** A redirect as the operations answer it: its slugs, and the paths on the site from its route. */
function redirectView(context: OperationContext, redirect: StoredRedirect): RedirectView {
  const collection = context.site.collections.get(redirect.collection)
  const path = (slug: string) =>
    collection === undefined ? null : entryPath(collection, redirect.locale, slug)
  return {
    collection: redirect.collection,
    locale: redirect.locale,
    from: redirect.from,
    to: redirect.to,
    fromPath: path(redirect.from),
    toPath: path(redirect.to),
    entryId: redirect.entryId,
  }
}

/**
 * Gives an entry another slug. A published entry changes a live URL, so moving it takes
 * content:publish; one that was ever published keeps its old slug as a redirect, and a published
 * one tells its subscribers, whose pages of it are purged by its tags.
 */
export const moveEntry: OperationHandler<'move_entry'> = async (input, context) => {
  const site = context.site.key
  const found = await context.store.findEntryById(site, input.id, 'head')
  if (found === null) return { outcome: 'not_found' }
  const { entry } = found
  if (entry.version !== input.version) {
    return { outcome: 'conflict', conflict: conflictAt(entry.version, entry.headRevision) }
  }
  if (entry.slug === input.slug) return { outcome: 'unchanged', entry: entrySummary(found) }
  const granted: readonly Scope[] = context.principal.scopes
  if (entry.status === 'published' && !granted.includes('content:publish')) {
    throw new HollwareError(
      'insufficient_scope',
      'The entry is published: changing its slug changes a live URL, which takes content:publish.',
      'Ask someone who may publish to move it, or move it while it is a draft.',
    )
  }
  const collection = collectionOfEntry(context.site, entry)
  const event =
    entry.status === 'published'
      ? eventFor({
          kind: 'entry.published',
          site: context.site,
          collection,
          entry: {
            id: entry.id,
            collection: entry.collection,
            locale: entry.locale,
            slug: input.slug,
            translationGroup: entry.translationGroup,
          },
          at: context.clock.now().toISOString(),
        })
      : null
  const written = await context.store.moveEntry(site, {
    entryId: entry.id,
    expectedVersion: input.version,
    slug: input.slug,
    redirect: entry.publishedAt !== null,
    event,
  })
  switch (written.outcome) {
    case 'moved': {
      if (event !== null) context.notify?.([event.id])
      const redirect: StoredRedirect = {
        id: '',
        collection: entry.collection,
        locale: entry.locale,
        from: entry.slug,
        to: input.slug,
        entryId: entry.id,
        createdAt: '',
      }
      return {
        outcome: 'moved',
        entry: entrySummary(written.view),
        ...(entry.publishedAt === null ? {} : { redirect: redirectView(context, redirect) }),
      }
    }
    case 'taken':
      return { outcome: 'taken' }
    case 'conflict':
      return {
        outcome: 'conflict',
        conflict: conflictAt(written.currentVersion, written.headRevision),
      }
    case 'not_found':
    case 'too_large':
      return { outcome: 'not_found' }
  }
}

/** The redirects of the site, newest first, a page at a time. */
export const listRedirects: OperationHandler<'list_redirects'> = async (input, context) => {
  const rows = await context.store.listRedirects(context.site.key, {
    ...(input.collection === undefined ? {} : { collection: input.collection }),
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    limit: input.limit + 1,
    cursor: parseCursor(input.cursor),
  })
  const page = rows.slice(0, input.limit)
  const last = page.at(-1)
  return {
    outcome: 'ok',
    redirects: page.map((redirect) => redirectView(context, redirect)),
    nextCursor: rows.length > input.limit && last !== undefined ? cursorOf(last) : null,
  }
}
