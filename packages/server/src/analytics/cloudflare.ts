import { isSiteKey } from '@hollware/core'
import type { AnalyticsReader, AnalyticsWriter, PageCount } from '../ports.ts'

/** The dataset of Analytics Engine when the Worker names none. */
export const DEFAULT_ANALYTICS_DATASET = 'hollware_page_views'

/** How long an answer of the SQL API is kept: it is slow, rate limited and minutes behind anyway. */
export const STATS_CACHE_SECONDS = 600

/** Where the SQL API of Analytics Engine answers. */
export function sqlApiUrl(accountId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`
}

interface AnalyticsBinding {
  writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Analytics Engine as the writer: one data point per view, indexed by the site (its sampling key),
 * with the path and the country as blobs and a count of 1.
 */
export function analyticsEngineWriter(binding: AnalyticsBinding): AnalyticsWriter {
  return {
    record(view) {
      binding.writeDataPoint({
        indexes: [view.site],
        blobs: [view.path, view.country],
        doubles: [1],
      })
    },
  }
}

/**
 * The query of the most read paths. The SQL API takes no parameters, so every value in it is
 * checked first: a site key (`[a-z0-9-]`), a dataset name and two whole numbers.
 */
export function topPagesSql(
  dataset: string,
  site: string,
  query: { readonly days: number; readonly limit: number },
): string {
  if (!/^[a-z_][a-z0-9_]{0,63}$/i.test(dataset)) throw new Error(`No dataset is named ${dataset}`)
  if (!isSiteKey(site)) throw new Error(`No site key is ${String(site)}`)
  if (!Number.isInteger(query.days) || query.days < 1 || query.days > 90) {
    throw new Error(`${query.days} days is not a whole number from 1 to 90`)
  }
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 50) {
    throw new Error(`${query.limit} pages is not a whole number from 1 to 50`)
  }
  return [
    'SELECT blob1 AS path, SUM(_sample_interval) AS views',
    `FROM ${dataset}`,
    `WHERE index1 = '${site}' AND timestamp > NOW() - INTERVAL '${query.days}' DAY`,
    'GROUP BY path',
    'ORDER BY views DESC',
    `LIMIT ${query.limit}`,
    'FORMAT JSON',
  ].join(' ')
}

/** What the reader needs: where to ask, with what, and where to keep answers. */
export interface SqlApiOptions {
  readonly accountId: string
  readonly token: string
  readonly dataset: string
  readonly fetch: (request: Request) => Promise<Response>
  /** A cache of answers; the Worker's default cache in production. */
  readonly cache: Pick<Cache, 'match' | 'put'> | null
}

/** The SQL API of Analytics Engine as the reader, its answers kept for ten minutes. */
export function sqlApiReader(options: SqlApiOptions): AnalyticsReader {
  return {
    async topPages(site, query) {
      const sql = topPagesSql(options.dataset, site, query)
      // The cache key names the query, never the token.
      const key = new Request(
        `https://hollware.invalid/content-stats/${options.dataset}/${site}?days=${query.days}&limit=${query.limit}`,
      )
      const cached = await options.cache?.match(key)
      const answer =
        cached ??
        (await options.fetch(
          new Request(sqlApiUrl(options.accountId), {
            method: 'POST',
            headers: { authorization: `Bearer ${options.token}` },
            body: sql,
          }),
        ))
      if (!answer.ok) throw new Error(`The SQL API of Analytics Engine answered ${answer.status}`)
      const text = await answer.text()
      if (cached === undefined && options.cache !== null) {
        await options.cache.put(
          key,
          new Response(text, { headers: { 'cache-control': `max-age=${STATS_CACHE_SECONDS}` } }),
        )
      }
      const body: unknown = JSON.parse(text)
      const data = isRecord(body) && Array.isArray(body['data']) ? body['data'] : []
      return data.flatMap((row: unknown): PageCount[] => {
        if (!isRecord(row) || typeof row['path'] !== 'string') return []
        const views = Number(row['views'])
        return Number.isFinite(views) ? [{ path: row['path'], views }] : []
      })
    },
  }
}

/** The writer over the Worker's `ANALYTICS` binding, or `null` without one. */
export function analyticsWriterOf(env: object): AnalyticsWriter | null {
  const binding: unknown = Reflect.get(env, 'ANALYTICS')
  if (!isRecord(binding) || typeof binding['writeDataPoint'] !== 'function') return null
  return analyticsEngineWriter(binding as unknown as AnalyticsBinding)
}

/**
 * The reader over the Worker's variables: `HOLLWARE_ANALYTICS_ACCOUNT_ID` and the secret
 * `HOLLWARE_ANALYTICS_TOKEN` (an API token with Account Analytics Read), and the dataset of
 * `HOLLWARE_ANALYTICS_DATASET` or the default one. `null` without the account or the token.
 */
export function analyticsReaderOf(env: object): AnalyticsReader | null {
  const accountId: unknown = Reflect.get(env, 'HOLLWARE_ANALYTICS_ACCOUNT_ID')
  const token: unknown = Reflect.get(env, 'HOLLWARE_ANALYTICS_TOKEN')
  const dataset: unknown = Reflect.get(env, 'HOLLWARE_ANALYTICS_DATASET')
  if (typeof accountId !== 'string' || accountId === '') return null
  if (typeof token !== 'string' || token === '') return null
  return sqlApiReader({
    accountId,
    token,
    dataset: typeof dataset === 'string' && dataset !== '' ? dataset : DEFAULT_ANALYTICS_DATASET,
    fetch: (request) => fetch(request),
    cache: typeof caches === 'undefined' ? null : caches.default,
  })
}
