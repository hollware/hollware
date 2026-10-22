import { analyticsSettings, newId, type AnalyticsProvider, type ResolvedSite } from '@hollware/core'
import type { D1Like } from '../db/d1.ts'
import type { AnalyticsConnection, AnalyticsSources, PageCount } from '../ports.ts'
import { seal, unseal } from '../structure/seal.ts'
import { cloudflareSource } from './cloudflare.ts'
import { ga4Source } from './ga4.ts'
import { hostsOf } from './normalize.ts'
import { plausibleSource } from './plausible.ts'
import { posthogSource } from './posthog.ts'
import { ProviderError, type Fetch } from './request.ts'
import type { Source, SourceInput } from './source.ts'

/*
 * The analytics connections of the sites (ADR-040): one row of `site_analytics` per site, its
 * credential sealed under HOLLWARE_SECRET and bound to the site and the name `analytics` (T-71),
 * and the provider asked through its adapter. Answers are kept ten minutes, under a key that names
 * the provider and the row's last change, never the credential (T-109).
 */

/** How long the counts of a provider are kept: they move slowly, and providers limit their APIs. */
export const STATS_CACHE_SECONDS = 600

/** The name a credential is sealed under: sealing binds it to the site and this name. */
export const SEALED_NAME = 'analytics'

/** How many days connecting asks the provider for, to check the credential before saving it. */
export const CHECK_DAYS = 7

const SOURCES: Record<AnalyticsProvider, (input: SourceInput) => Source> = {
  cloudflare: cloudflareSource,
  ga4: ga4Source,
  plausible: plausibleSource,
  posthog: posthogSource,
}

const CONNECT_FIX =
  'Connect the analytics the site already has: in the admin, Site, Analytics, or with `hollware analytics connect`.'

interface Row {
  provider: AnalyticsProvider
  settings: string
  sealed: string
  created_at: string
  updated_at: string
  checked_at: string | null
}

export interface AnalyticsSourcesOptions {
  readonly db: D1Like
  /** HOLLWARE_SECRET; without it nothing can be sealed or opened. */
  readonly master: string | undefined
  readonly fetch: Fetch
  readonly cache: Pick<Cache, 'match' | 'put'> | null
  readonly now: () => Date
}

export function createAnalyticsSources(options: AnalyticsSourcesOptions): AnalyticsSources {
  const { db } = options
  const read = (site: string) =>
    db
      .prepare(
        'SELECT provider, settings, sealed, created_at, updated_at, checked_at FROM site_analytics WHERE site_id = ?1',
      )
      .bind(site)
      .first<Row>()
  const settingsOf = (row: Row) => analyticsSettings.parse(JSON.parse(row.settings))
  const sourceOf = (
    site: ResolvedSite,
    provider: AnalyticsProvider,
    credential: string,
    settings: SourceInput['settings'],
  ) => {
    const hosts = hostsOf(site.url, settings.hosts)
    if (hosts.length === 0) {
      throw new ProviderError(
        'invalid',
        'The site has no url, so its views cannot be told from those of other sites.',
        "Give the site its url with update_site, or pass settings.hosts: the hosts of the site's pages.",
      )
    }
    return SOURCES[provider]({
      fetch: options.fetch,
      credential,
      settings,
      hosts,
      now: options.now,
    })
  }

  return {
    async connection(site): Promise<AnalyticsConnection | null> {
      const row = await read(site)
      if (row === null) return null
      return {
        provider: row.provider,
        settings: settingsOf(row),
        connectedAt: row.created_at,
        checkedAt: row.checked_at,
      }
    },

    async topPages(site, query) {
      const row = await read(site.key)
      if (row === null) return { outcome: 'unavailable', fix: CONNECT_FIX }
      if (options.master === undefined) {
        return {
          outcome: 'unavailable',
          fix: 'Set HOLLWARE_SECRET on the Worker: `hollware deploy` makes one. The connection opens with it.',
        }
      }
      const credential = await unseal(options.master, row.sealed, {
        site: site.key,
        name: SEALED_NAME,
      })
      if (credential === null) {
        return {
          outcome: 'unavailable',
          fix: `The credential no longer opens (HOLLWARE_SECRET changed). ${CONNECT_FIX}`,
        }
      }
      const key = `https://hollware.invalid/content-stats/${row.provider}/${site.key}?changed=${encodeURIComponent(row.updated_at)}&days=${query.days}&limit=${query.limit}`
      const cached = await options.cache?.match(key)
      if (cached !== undefined) {
        return {
          outcome: 'ok',
          provider: row.provider,
          pages: (await cached.json()) as PageCount[],
        }
      }
      try {
        const pages = await sourceOf(site, row.provider, credential, settingsOf(row)).topPages(
          query.days,
          query.limit,
        )
        await options.cache?.put(
          key,
          new Response(JSON.stringify(pages), {
            headers: {
              'content-type': 'application/json',
              'cache-control': `max-age=${STATS_CACHE_SECONDS}`,
            },
          }),
        )
        return { outcome: 'ok', provider: row.provider, pages }
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error
        return { outcome: 'unavailable', fix: `${error.message} ${error.fix}` }
      }
    },

    async connect(site, input) {
      if (options.master === undefined) return { outcome: 'unavailable' }
      try {
        const settings = await sourceOf(
          site,
          input.provider,
          input.credential,
          input.settings,
        ).discover()
        const pages = await sourceOf(site, input.provider, input.credential, settings).topPages(
          CHECK_DAYS,
          50,
        )
        const sealed = await seal(options.master, input.credential, {
          site: site.key,
          name: SEALED_NAME,
        })
        const at = options.now().toISOString()
        await db
          .prepare(
            `INSERT INTO site_analytics (id, site_id, provider, settings, sealed, checked_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
             ON CONFLICT (site_id) DO UPDATE SET provider = excluded.provider, settings = excluded.settings,
               sealed = excluded.sealed, checked_at = excluded.checked_at, created_at = excluded.created_at,
               updated_at = excluded.updated_at`,
          )
          .bind(newId('ana'), site.key, input.provider, JSON.stringify(settings), sealed, at)
          .run()
        return {
          outcome: 'connected',
          settings,
          views: pages.reduce((sum, page) => sum + page.views, 0),
          paths: pages.length,
        }
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error
        return { outcome: error.kind, message: error.message, fix: error.fix }
      }
    },

    async disconnect(site) {
      const result = await db
        .prepare('DELETE FROM site_analytics WHERE site_id = ?1')
        .bind(site)
        .run()
      return result.meta.changes > 0
    },
  }
}
