import type { AnalyticsSettings } from '@hollware/core'
import { ranked, sinceOf } from './normalize.ts'
import { isRecord, messageOf, ProviderError, request } from './request.ts'
import { rowsFor, type Source, type SourceInput } from './source.ts'

/*
 * Plausible (ADR-040): the page views of a site by `event:page`, from the Stats API v2 with a
 * Stats API key. The site is its domain in Plausible, the host of the site's url unless named.
 */

export const PLAUSIBLE_CLOUD = 'https://plausible.io'

const KEY_FIX =
  'Use a Stats API key of Plausible: in Plausible, Account settings, API keys, choose Stats API.'

export function plausibleSource(input: SourceInput): Source {
  return {
    async discover(): Promise<AnalyticsSettings> {
      return {
        ...input.settings,
        host: input.settings.host ?? PLAUSIBLE_CLOUD,
        siteId: input.settings.siteId ?? input.hosts[0],
      }
    },

    async topPages(days, limit) {
      const host = input.settings.host ?? PLAUSIBLE_CLOUD
      const siteId = input.settings.siteId ?? input.hosts[0]
      const today = input.now().toISOString().slice(0, 10)
      const { status, body } = await request(input.fetch, 'Plausible', `${host}/api/v2/query`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${input.credential}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          site_id: siteId,
          metrics: ['pageviews'],
          date_range: [sinceOf(input.now(), days), today],
          dimensions: ['event:page'],
          order_by: [['pageviews', 'desc']],
          pagination: { limit: rowsFor(limit) },
        }),
      })
      const message = () => messageOf(body, [input.credential])
      if (status === 401 || status === 403) throw new ProviderError('refused', message(), KEY_FIX)
      if (status === 400 || status === 404) {
        throw new ProviderError(
          'invalid',
          message(),
          "Pass settings.siteId: the domain of the site as Plausible has it, under the site's settings.",
        )
      }
      if (status !== 200) {
        throw new ProviderError(
          'unreachable',
          `Plausible answered ${status}: ${message()}`,
          'Try again in a minute.',
        )
      }
      const results = isRecord(body) && Array.isArray(body['results']) ? body['results'] : []
      return ranked(
        results.flatMap((row) => {
          if (
            !isRecord(row) ||
            !Array.isArray(row['dimensions']) ||
            !Array.isArray(row['metrics'])
          ) {
            return []
          }
          const path: unknown = row['dimensions'][0]
          const views: unknown = row['metrics'][0]
          return typeof path === 'string' && typeof views === 'number' ? [{ path, views }] : []
        }),
        limit,
      )
    },
  }
}
