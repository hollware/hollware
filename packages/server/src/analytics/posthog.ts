import type { AnalyticsSettings } from '@hollware/core'
import { ranked } from './normalize.ts'
import { isRecord, messageOf, ProviderError, request } from './request.ts'
import { rowsFor, type Source, type SourceInput } from './source.ts'

export const POSTHOG_CLOUD = ['https://us.posthog.com', 'https://eu.posthog.com'] as const

const KEY_FIX =
  'Use a personal API key of PostHog (Settings, User, Personal API keys) with Query read, scoped to the project of the site.'
const QUERY_FIX =
  'Give the key the scope Query: read, in PostHog under Settings, User, Personal API keys.'

export function pagesHogql(hosts: readonly string[], days: number, limit: number): string {
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new Error(`Not a number of days: ${days}`)
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error(`Not a limit: ${limit}`)
  for (const host of hosts) {
    if (!/^[a-z0-9.-]+$/.test(host)) throw new Error(`Not a host name: ${JSON.stringify(host)}`)
  }
  const list = hosts.map((host) => `'${host}'`).join(', ')
  return `SELECT properties.$pathname AS path, count() AS views FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY AND properties.$host IN (${list}) GROUP BY path ORDER BY views DESC LIMIT ${limit}`
}

export function posthogSource(input: SourceInput): Source {
  const headers = { authorization: `Bearer ${input.credential}` }

  return {
    async discover(): Promise<AnalyticsSettings> {
      const candidates = input.settings.host === undefined ? POSTHOG_CLOUD : [input.settings.host]
      for (const host of candidates) {
        const { status, body } = await request(
          input.fetch,
          'PostHog',
          `${host}/api/projects/@current/`,
          {
            headers,
          },
        )
        if (status === 200 && isRecord(body) && typeof body['id'] === 'number') {
          return { ...input.settings, host, projectId: input.settings.projectId ?? body['id'] }
        }
        if (status === 403 && input.settings.projectId !== undefined) {
          return { ...input.settings, host }
        }
        if (status === 403) {
          throw new ProviderError(
            'refused',
            messageOf(body, [input.credential]),
            'Give the key the scope Project: read too, or pass settings.projectId: the number in the URL of the project.',
          )
        }
        if (status !== 401) {
          throw new ProviderError(
            'unreachable',
            `PostHog answered ${status}.`,
            'Try again in a minute.',
          )
        }
      }
      throw new ProviderError('refused', 'PostHog does not know this key.', KEY_FIX)
    },

    async topPages(days, limit) {
      const { host, projectId } = input.settings
      if (host === undefined || projectId === undefined) {
        throw new ProviderError('invalid', 'No PostHog project.', 'Connect the analytics again.')
      }
      const { status, body } = await request(
        input.fetch,
        'PostHog',
        `${host}/api/projects/${projectId}/query/`,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            query: { kind: 'HogQLQuery', query: pagesHogql(input.hosts, days, rowsFor(limit)) },
          }),
        },
      )
      const message = () => messageOf(body, [input.credential])
      if (status === 401) throw new ProviderError('refused', message(), KEY_FIX)
      if (status === 403) throw new ProviderError('refused', message(), QUERY_FIX)
      if (status !== 200) {
        throw new ProviderError(
          'unreachable',
          `PostHog answered ${status}: ${message()}`,
          'Try again in a minute.',
        )
      }
      const results = isRecord(body) && Array.isArray(body['results']) ? body['results'] : []
      return ranked(
        results.flatMap((row) => {
          if (!Array.isArray(row)) return []
          const [path, views] = row as unknown[]
          return typeof path === 'string' && typeof views === 'number' ? [{ path, views }] : []
        }),
        limit,
      )
    },
  }
}
