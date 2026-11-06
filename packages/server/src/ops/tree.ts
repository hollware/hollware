import type { ResolvedCollection } from '@hollware/core'
import type { EntryParent, StoredEntry, View } from '../ports.ts'
import { entrySummary } from './answers.ts'
import type { OperationContext } from './types.ts'

export type ParentProblem = 'not_nested' | 'missing' | 'too_deep'

export function depthOf(slugPath: string): number {
  return slugPath.split('/').length
}

export function heightOf(entry: StoredEntry, descendants: readonly StoredEntry[]): number {
  const own = depthOf(entry.slugPath)
  return descendants.reduce(
    (height, descendant) => Math.max(height, depthOf(descendant.slugPath) - own + 1),
    1,
  )
}

export async function parentFor(
  context: OperationContext,
  collection: ResolvedCollection,
  locale: string,
  slug: string,
  height: number,
): Promise<
  | { readonly parent: EntryParent & { readonly entry: StoredEntry } }
  | { readonly problem: ParentProblem }
> {
  if (collection.nesting === null) return { problem: 'not_nested' }
  const found = await context.store.findEntry(
    context.site.key,
    { collection: collection.name, locale, slug },
    'head',
  )
  if (found === null) return { problem: 'missing' }
  if (depthOf(found.entry.slugPath) + height > collection.nesting.maxDepth) {
    return { problem: 'too_deep' }
  }
  return {
    parent: { id: found.entry.id, slugPath: found.entry.slugPath, entry: found.entry },
  }
}

export async function childrenView(context: OperationContext, entry: StoredEntry, view: View) {
  const children = await context.store.childrenOf(
    context.site.key,
    { collection: entry.collection, locale: entry.locale, parentId: entry.id },
    view,
  )
  return children.map((child) => entrySummary(child))
}
