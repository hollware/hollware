import { HollwareError, type OperationByName, type Scope } from '@hollware/core'
import type * as z from 'zod'
import type { EntryParent, StoredRedirect } from '../ports.ts'
import { conflictAt, entrySummary } from './answers.ts'
import { cursorOf, parseCursor } from './assets.ts'
import { collectionOfEntry } from './collections.ts'
import { entryPath, eventFor } from './event.ts'
import { descendantsSnapshot, heightOf, parentFor, TREE_ATTEMPTS, treeOf } from './tree.ts'
import type { OperationContext, OperationHandler } from './types.ts'

type RedirectView = z.output<OperationByName<'list_redirects'>['output']>['redirects'][number]

function redirectView(context: OperationContext, redirect: StoredRedirect): RedirectView {
  const collection = context.site.collections.get(redirect.collection)
  const path = (slugPath: string) =>
    collection === undefined ? null : entryPath(collection, redirect.locale, slugPath)
  return {
    collection: redirect.collection,
    locale: redirect.locale,
    from: redirect.from,
    to: redirect.to,
    fromPath: path(redirect.fromSlugPath),
    toPath: path(redirect.toSlugPath),
    entryId: redirect.entryId,
  }
}

type MoveOutput = Awaited<ReturnType<OperationHandler<'move_entry'>>>
type InvalidParent = NonNullable<MoveOutput['reason']>

function invalid(reason: InvalidParent): MoveOutput {
  return { outcome: 'invalid_parent', reason }
}

function parentPathOf(slugPath: string): string | null {
  const slash = slugPath.lastIndexOf('/')
  return slash === -1 ? null : slugPath.slice(0, slash)
}

function ordered(ids: readonly string[], moving: string, index: number): string[] {
  const rest = ids.filter((id) => id !== moving)
  rest.splice(Math.min(index, rest.length), 0, moving)
  return rest
}

export const moveEntry: OperationHandler<'move_entry'> = async (input, context) => {
  for (let attempt = 1; attempt <= TREE_ATTEMPTS; attempt += 1) {
    const answer = await moveOnce(input, context)
    if (answer !== 'retry') return answer
  }
  const found = await context.store.findEntryById(context.site.key, input.id, 'head')
  if (found === null) return { outcome: 'not_found' }
  return {
    outcome: 'conflict',
    conflict: conflictAt(found.entry.version, found.entry.headRevision),
  }
}

async function moveOnce(
  input: Parameters<OperationHandler<'move_entry'>>[0],
  context: OperationContext,
): Promise<MoveOutput | 'retry'> {
  const site = context.site.key
  const found = await context.store.findEntryById(site, input.id, 'head')
  if (found === null) return { outcome: 'not_found' }
  const { entry } = found
  if (entry.version !== input.version) {
    return { outcome: 'conflict', conflict: conflictAt(entry.version, entry.headRevision) }
  }
  const collection = collectionOfEntry(context.site, entry)
  const nested = collection.nesting !== null
  if (!nested && (input.parent !== undefined || input.index !== undefined)) {
    return invalid('not_nested')
  }
  const slug = input.slug ?? entry.slug
  const parentSlug = input.parent === undefined ? entry.parent : input.parent
  const reparented = parentSlug !== entry.parent
  if (slug === entry.slug && !reparented && input.index === undefined) {
    return { outcome: 'unchanged', entry: entrySummary(found) }
  }
  const descendants = await context.store.descendantsOf(site, {
    collection: entry.collection,
    locale: entry.locale,
    slugPath: entry.slugPath,
  })
  let parent: EntryParent | null = null
  if (parentSlug !== null && !reparented) {
    const path = parentPathOf(entry.slugPath)
    if (entry.parentId !== null && path !== null) parent = { id: entry.parentId, slugPath: path }
  } else if (parentSlug !== null) {
    if (parentSlug === entry.slug || descendants.some((child) => child.slug === parentSlug)) {
      return invalid('cycle')
    }
    const placed = await parentFor(
      context,
      collection,
      entry.locale,
      parentSlug,
      heightOf(entry, descendants),
    )
    if ('problem' in placed) return invalid(placed.problem)
    if (entry.status === 'published' && placed.parent.entry.status !== 'published') {
      return invalid('unpublished')
    }
    parent = { id: placed.parent.id, slugPath: placed.parent.slugPath }
  }
  const granted: readonly Scope[] = context.principal.scopes
  const slugPath = parent === null ? slug : `${parent.slugPath}/${slug}`
  const pathChanged = slugPath !== entry.slugPath
  if (entry.status === 'published' && pathChanged && !granted.includes('content:publish')) {
    throw new HollwareError(
      'insufficient_scope',
      'The entry is published: moving it changes a live URL, which takes content:publish.',
      'Ask someone who may publish to move it, or move it while it is a draft.',
    )
  }
  let position: number | null = null
  const positions: { id: string; position: number }[] = []
  if (nested) {
    const ref = { collection: entry.collection, locale: entry.locale }
    const siblings = await context.store.childrenOf(
      site,
      { ...ref, parentId: parent?.id ?? null },
      'head',
    )
    const ids = siblings.map((sibling) => sibling.entry.id)
    const current = ids.indexOf(entry.id)
    const index = input.index ?? (current === -1 ? ids.length : current)
    const order = ordered(ids, entry.id, index)
    position = order.indexOf(entry.id)
    order.forEach((id, at) => {
      const sibling = siblings.find((one) => one.entry.id === id)
      if (id !== entry.id && sibling?.entry.position !== at) positions.push({ id, position: at })
    })
    if (reparented) {
      const left = await context.store.childrenOf(
        site,
        { ...ref, parentId: entry.parentId },
        'head',
      )
      left
        .filter((sibling) => sibling.entry.id !== entry.id)
        .forEach((sibling, at) => {
          if (sibling.entry.position !== at) positions.push({ id: sibling.entry.id, position: at })
        })
    }
  }
  const at = context.clock.now().toISOString()
  const live = descendants.filter((child) => child.deletedAt === null)
  const moved = [
    { before: entry, after: { ...entry, slug, slugPath } },
    ...live.map((child) => ({
      before: child,
      after: { ...child, slugPath: `${slugPath}${child.slugPath.slice(entry.slugPath.length)}` },
    })),
  ]
  const events = moved
    .filter(
      ({ before }) => before.status === 'published' && (before.id === entry.id || pathChanged),
    )
    .map(({ after }) => ({
      entryId: after.id,
      event: eventFor({
        kind: 'entry.published',
        site: context.site,
        collection,
        entry: {
          id: after.id,
          collection: after.collection,
          locale: after.locale,
          slug: after.slug,
          translationGroup: after.translationGroup,
        },
        slugPath: after.slugPath,
        at,
      }),
    }))
  const redirects = pathChanged
    ? moved
        .filter(({ before }) => before.publishedAt !== null)
        .map(({ before }) => ({
          entryId: before.id,
          fromSlug: before.slug,
          fromPath: before.slugPath,
        }))
    : []
  const written = await context.store.moveEntry(site, {
    entryId: entry.id,
    expectedVersion: input.version,
    slug,
    slugPath,
    parent,
    position,
    positions,
    subtree: pathChanged && descendants.length > 0 ? { from: entry.slugPath, to: slugPath } : null,
    events,
    redirects,
    descendants: descendantsSnapshot(descendants),
    livePaths: moved.map(({ after }) => after.slugPath),
    tree: treeOf(context.site, entry.collection, entry.locale),
  })
  switch (written.outcome) {
    case 'moved': {
      if (events.length > 0) context.notify?.(events.map(({ event }) => event.id))
      const redirect: StoredRedirect = {
        id: '',
        collection: entry.collection,
        locale: entry.locale,
        from: entry.slug,
        to: slug,
        fromSlugPath: entry.slugPath,
        toSlugPath: slugPath,
        entryId: entry.id,
        createdAt: '',
      }
      return {
        outcome: 'moved',
        entry: entrySummary(written.view),
        ...(entry.publishedAt === null || !pathChanged
          ? {}
          : { redirect: redirectView(context, redirect) }),
      }
    }
    case 'tree_changed':
      return 'retry'
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
