import type { DataStore, LiveLoader, Loader, LoaderContext } from 'astro/loaders'
import {
  asError,
  createSource,
  type ListOptions,
  type ReaderOptions,
  type Source,
  type SourceOptions,
  type SourceEntry,
  type Translation,
} from './source.ts'

export const name = '@hollware/astro'

export type {
  ListOptions,
  ReaderOptions,
  Source,
  SourceEntry,
  SourceOptions,
  Translation,
} from './source.ts'
export type { HollwareReader } from '@hollware/client'
export { createSource } from './source.ts'
export {
  contentNodes,
  elementOf,
  imageOf,
  type ContentElement,
  type ContentNode,
  type HollwareEntryLike,
  type HollwareMetadata,
} from './content.ts'
export { hollwareBinding } from '@hollware/client'
export { hollwarePreview, refusePreview, type HollwarePreviewLocals } from './preview.ts'

function withMetadata(html: string, entry: SourceEntry) {
  const metadata = {
    ...(entry.document === undefined ? {} : { document: entry.document }),
    ...(entry.images === undefined ? {} : { images: entry.images }),
  }
  return Object.keys(metadata).length === 0 ? { html } : { html, metadata }
}

/** The options of `hollwareLoader`. */
export type HollwareLoaderOptions = SourceOptions & ReaderOptions

/**
 * A content loader for `defineCollection` in `src/content.config.ts`: it reads the published
 * entries of one collection of a Hollware site at build time (and when the content layer is
 * refreshed), over HTTP with a read token or through any reader. An entry's id is its slug, its
 * data the frontmatter, and its `rendered.html` the HTML Hollware made, so Astro's `render(entry)`
 * works. A schema in `defineCollection` validates the frontmatter.
 */
export function hollwareLoader(options: HollwareLoaderOptions): Loader {
  const source = createSource(options)
  return {
    name: `${name}:${options.collection}:${options.locale}`,
    load: (context) => loadInto(source, context),
  }
}

/** What a build-time load needs of Astro's `LoaderContext`. */
export interface LoadContext {
  readonly store: Pick<DataStore, 'set' | 'keys' | 'delete'>
  readonly parseData: LoaderContext['parseData']
  readonly generateDigest: LoaderContext['generateDigest']
  readonly logger: Pick<LoaderContext['logger'], 'info'>
}

/**
 * Stores every published entry of the source with its HTML, its data validated by the schema of
 * the collection, and removes what is no longer published.
 */
export async function loadInto(source: Source, context: LoadContext): Promise<void> {
  const { store, logger } = context
  const seen = new Set<string>()
  for (const summary of await source.list()) {
    const entry = await source.get(summary.id)
    if (entry === undefined) continue
    const data = await context.parseData({ id: entry.id, data: entry.data })
    const html = entry.html ?? ''
    store.set({
      id: entry.id,
      data,
      rendered: withMetadata(html, entry),
      digest: context.generateDigest({ data, html }),
    })
    seen.add(entry.id)
  }
  for (const id of store.keys()) {
    if (!seen.has(id)) store.delete(id)
  }
  logger.info(`Loaded ${seen.size} published entries`)
}

/** The filter of `getLiveCollection`. */
export type HollwareCollectionFilter = ListOptions

/**
 * The filter of `getLiveEntry`: the slug, and the preview token of the page's URL
 * (`?hollware-preview=`), which reads the latest revision of its entry, a draft included.
 */
export interface HollwareEntryFilter {
  readonly id: string
  readonly preview?: string | undefined
}

/**
 * A live loader for `defineLiveCollection` in `src/live.config.ts`: it reads at request time, so
 * a publish shows on the next request with no rebuild. On Workers, give it the service binding
 * through a function, because the binding exists only while a request runs:
 *
 * ```ts
 * import { env } from 'cloudflare:workers'
 * hollwareLiveLoader({
 *   site: 'my-site',
 *   collection: 'blog',
 *   locale: 'en',
 *   reader: () => hollwareBinding(env.HOLLWARE),
 * })
 * ```
 *
 * `getLiveEntry('blog', slug)` has the entry with its `rendered.html`; `getLiveEntry('blog', { id:
 * slug, preview })`, with the `hollware-preview` of the page's URL, has its latest revision, a
 * draft included, and the page must answer `Cache-Control: no-store` then; `getLiveCollection('blog',
 * { tag, limit })` lists the entries without it.
 */
export function hollwareLiveLoader(
  options: HollwareLoaderOptions,
): LiveLoader<Record<string, unknown>, HollwareEntryFilter, HollwareCollectionFilter> {
  const source = createSource(options)
  return {
    name: `${name}:${options.collection}:${options.locale}`,
    async loadEntry({ filter }) {
      try {
        const preview = filter.preview === '' ? undefined : filter.preview
        const entry = await source.get(filter.id, preview === undefined ? {} : { preview })
        if (entry === undefined) return undefined
        return {
          id: entry.id,
          data: entry.data,
          rendered: withMetadata(entry.html ?? '', entry),
          ...(preview === undefined
            ? { cacheHint: { lastModified: new Date(entry.updatedAt) } }
            : {}),
        }
      } catch (error) {
        return { error: asError(error) }
      }
    },
    async loadCollection({ filter }) {
      try {
        const entries = await source.list(filter)
        return {
          entries: entries.map((entry) => ({
            id: entry.id,
            data: entry.data,
            ...(entry.images === undefined
              ? {}
              : { rendered: { html: '', metadata: { images: entry.images } } }),
            cacheHint: { lastModified: new Date(entry.updatedAt) },
          })),
        }
      } catch (error) {
        return { error: asError(error) }
      }
    },
  }
}

/**
 * The entries of a translation group of a collection, one per locale: `{ locale, slug }`, to
 * link to. The group is the value of the frontmatter field that `describe_site` names as
 * `translationGroupField`.
 */
export function hollwareTranslations(
  options: HollwareLoaderOptions,
  group: string,
): Promise<Translation[]> {
  return createSource(options).translations(group)
}
