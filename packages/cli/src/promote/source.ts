import { getEntry, listEntries } from '@hollware/core'
import { CliError } from '../errors.ts'
import { printable } from '../format.ts'
import { ToolFailure, type Session } from '../import/session.ts'
import { scopeOf, type PromoteState } from './state.ts'

const PAGE_SIZE = 100

export interface Scope {
  collection: string
  locale: string | undefined
  tag: string | undefined
  since: string | undefined
}

export interface SourceEntry {
  path: string
  collection: string
  locale: string
  slug: string
  entryId: string
  revision: string
  markdown: string
  acknowledged: { contract: string; path: string }[]
}

export interface SourceChanges {
  changed: SourceEntry[]
  gone: string[]
  latest: Map<string, string>
}

interface Listed {
  id: string
  path: string
  collection: string
  locale: string
  slug: string
  published: boolean
}

export async function readSource(
  session: Session,
  scopes: readonly Scope[],
  state: PromoteState,
): Promise<SourceChanges> {
  const changed: SourceEntry[] = []
  const gone: string[] = []
  const latest = new Map<string, string>()
  for (const scope of scopes) {
    const listed: Listed[] = []
    let newest: string | undefined
    for (const trashed of [false, true]) {
      let cursor: string | undefined
      do {
        let page
        try {
          page = await session.call(listEntries, {
            collection: scope.collection,
            ...(scope.locale === undefined ? {} : { locale: scope.locale }),
            ...(scope.tag === undefined ? {} : { tag: scope.tag }),
            ...(scope.since === undefined ? {} : { changedSince: scope.since }),
            ...(trashed ? { trashed } : {}),
            limit: PAGE_SIZE,
            ...(cursor === undefined ? {} : { cursor }),
          })
        } catch (error) {
          if (!(error instanceof ToolFailure)) throw error
          throw new CliError(
            `could not list ${printable(scope.collection)} in the source: ${error.message}. Nothing was written.`,
          )
        }
        for (const summary of page.entries) {
          if (newest === undefined || summary.updatedAt > newest) newest = summary.updatedAt
          listed.push({
            id: summary.id,
            path: `${summary.collection}/${summary.locale}/${summary.slug}`,
            collection: summary.collection,
            locale: summary.locale,
            slug: summary.slug,
            published: !trashed && summary.status === 'published',
          })
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor !== undefined)
    }
    if (newest !== undefined) latest.set(scopeOf(scope.collection, scope.locale, scope.tag), newest)

    const published = new Set(listed.filter((one) => one.published).map((one) => one.path))
    const seen = new Set(listed.map((one) => one.id))
    for (const one of listed) {
      if (!one.published) continue
      const read = await readPublished(session, one)
      const known = state.entries[one.path]
      if (known?.sourceRevision === read.revision && known.unpublish !== true) continue
      changed.push(read)
    }
    for (const [path, known] of Object.entries(state.entries)) {
      const [collection, locale] = path.split('/')
      if (collection !== scope.collection) continue
      if (scope.locale !== undefined && locale !== scope.locale) continue
      if (published.has(path)) continue
      const complete = scope.since === undefined && scope.tag === undefined
      if (known.unpublish === true || seen.has(known.sourceEntry) || complete) gone.push(path)
    }
  }
  return { changed, gone, latest }
}

async function readPublished(session: Session, listed: Listed): Promise<SourceEntry> {
  let answer
  try {
    answer = await session.call(getEntry, {
      collection: listed.collection,
      locale: listed.locale,
      slug: listed.slug,
      formats: ['markdown'],
      published: true,
    })
  } catch (error) {
    if (!(error instanceof ToolFailure)) throw error
    throw new CliError(
      `could not read ${printable(listed.path)} in the source: ${error.message}. Nothing was written.`,
    )
  }
  const entry = answer.entry
  if (answer.outcome !== 'ok' || entry?.markdown === undefined) {
    throw new CliError(
      `${printable(listed.path)} was unpublished in the source while promote read it. Nothing was written: run it again.`,
    )
  }
  return {
    path: listed.path,
    collection: listed.collection,
    locale: listed.locale,
    slug: listed.slug,
    entryId: entry.id,
    revision: entry.revision,
    markdown: entry.markdown,
    acknowledged: entry.lastPublication?.acknowledged ?? [],
  }
}
