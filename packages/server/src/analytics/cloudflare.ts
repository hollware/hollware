import type { AnalyticsSettings } from '@hollware/core'
import { ranked, sinceOf } from './normalize.ts'
import { isRecord, messageOf, ProviderError, request } from './request.ts'
import { rowsFor, type Source, type SourceInput } from './source.ts'

export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'

const ACCOUNT_FIX =
  'Pass settings.accountId: the 32 characters after dash.cloudflare.com/ in the address of the dashboard.'

const REFUSED_FIX =
  'Give the token Account Analytics Read on the account: in Cloudflare, My Profile, API Tokens, edit the token.'

export const PAGES_QUERY = `query ($account: String!, $since: Date!, $hosts: [String!]) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      pages: rumPageloadEventsAdaptiveGroups(
        limit: %LIMIT%
        filter: { date_geq: $since, requestHost_in: $hosts }
        orderBy: [count_DESC]
      ) {
        count
        dimensions { requestPath }
      }
    }
  }
}`

export function cloudflareSource(input: SourceInput): Source {
  const headers = { authorization: `Bearer ${input.credential}` }
  const refusedOr = (status: number, body: unknown, what: string): never => {
    const message = messageOf(body, [input.credential])
    if (status === 401 || status === 403) throw new ProviderError('refused', message, REFUSED_FIX)
    throw new ProviderError(
      'unreachable',
      `${what} answered ${status}: ${message}`,
      'Try again in a minute.',
    )
  }

  return {
    async discover(): Promise<AnalyticsSettings> {
      if (input.settings.accountId === undefined) {
        throw new ProviderError('invalid', 'Cloudflare needs the account to read.', ACCOUNT_FIX)
      }
      return input.settings
    },

    async topPages(days, limit) {
      const account = input.settings.accountId
      if (account === undefined) {
        throw new ProviderError('invalid', 'No Cloudflare account.', 'Connect the analytics again.')
      }
      const { status, body } = await request(
        input.fetch,
        'Cloudflare',
        `${CLOUDFLARE_API}/graphql`,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            query: PAGES_QUERY.replace('%LIMIT%', String(rowsFor(limit))),
            variables: { account, since: sinceOf(input.now(), days), hosts: input.hosts },
          }),
        },
      )
      if (status !== 200) refusedOr(status, body, 'Cloudflare')
      const errors = isRecord(body) && Array.isArray(body['errors']) ? body['errors'] : []
      if (errors.length > 0) {
        const message = messageOf(body, [input.credential])
        const refused = /authoriz|permission|access/i.test(message)
        throw new ProviderError(
          refused ? 'refused' : 'invalid',
          message,
          refused ? REFUSED_FIX : 'Check settings.accountId.',
        )
      }
      const data = isRecord(body) ? body['data'] : undefined
      const viewer = isRecord(data) ? data['viewer'] : undefined
      const accounts =
        isRecord(viewer) && Array.isArray(viewer['accounts']) ? viewer['accounts'] : []
      const first: unknown = accounts[0]
      const rows = isRecord(first) && Array.isArray(first['pages']) ? first['pages'] : []
      return ranked(
        rows.flatMap((row) => {
          if (!isRecord(row) || !isRecord(row['dimensions'])) return []
          const path = row['dimensions']['requestPath']
          const views = row['count']
          return typeof path === 'string' && typeof views === 'number' ? [{ path, views }] : []
        }),
        limit,
      )
    },
  }
}
