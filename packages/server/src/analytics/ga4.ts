import type { AnalyticsSettings } from '@hollware/core'
import { ranked } from './normalize.ts'
import { isRecord, messageOf, ProviderError, request } from './request.ts'
import { rowsFor, type Source, type SourceInput } from './source.ts'

/*
 * Google Analytics 4 (ADR-040): `screenPageViews` by `pagePath` from the Data API, as a service
 * account that can view the property. Its JSON key signs a JWT (RS256, with Web Crypto) that
 * Google's token endpoint trades for an access token of `analytics.readonly`.
 */

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GA4_DATA_API = 'https://analyticsdata.googleapis.com/v1beta'
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'

const KEY_FIX =
  'Paste the JSON key of a Google Cloud service account: IAM, Service accounts, the account, Keys, Add key, JSON.'

/** The parts of a service account's JSON key that sign. */
export interface ServiceAccount {
  readonly clientEmail: string
  readonly privateKey: string
}

/** The service account of a JSON key, or an `invalid` error that says what is missing. */
export function serviceAccountOf(credential: string): ServiceAccount {
  let parsed: unknown
  try {
    parsed = JSON.parse(credential)
  } catch {
    throw new ProviderError('invalid', 'The credential is not JSON.', KEY_FIX)
  }
  if (
    !isRecord(parsed) ||
    typeof parsed['client_email'] !== 'string' ||
    typeof parsed['private_key'] !== 'string' ||
    !parsed['private_key'].includes('PRIVATE KEY')
  ) {
    throw new ProviderError('invalid', 'The JSON has no client_email and private_key.', KEY_FIX)
  }
  return { clientEmail: parsed['client_email'], privateKey: parsed['private_key'] }
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

const encoded = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)))

/** The JWT a service account sends to the token endpoint, signed with its key: valid one hour. */
export async function signedAssertion(account: ServiceAccount, now: Date): Promise<string> {
  const der = Uint8Array.from(
    atob(account.privateKey.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')),
    (c) => c.charCodeAt(0),
  )
  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
  } catch {
    throw new ProviderError('invalid', 'The private_key of the JSON does not read.', KEY_FIX)
  }
  const issuedAt = Math.floor(now.getTime() / 1000)
  const unsigned = `${encoded({ alg: 'RS256', typ: 'JWT' })}.${encoded({
    iss: account.clientEmail,
    scope: SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  })}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  )
  return `${unsigned}.${base64url(new Uint8Array(signature))}`
}

export function ga4Source(input: SourceInput): Source {
  const secrets = (account: ServiceAccount) => [input.credential, account.privateKey]

  const accessToken = async (account: ServiceAccount): Promise<string> => {
    const { status, body } = await request(input.fetch, 'Google', GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: await signedAssertion(account, input.now()),
      }).toString(),
    })
    const token = isRecord(body) ? body['access_token'] : undefined
    if (status === 200 && typeof token === 'string') return token
    if (status === 400 || status === 401) {
      throw new ProviderError('refused', messageOf(body, secrets(account)), KEY_FIX)
    }
    throw new ProviderError('unreachable', `Google answered ${status}.`, 'Try again in a minute.')
  }

  return {
    async discover(): Promise<AnalyticsSettings> {
      serviceAccountOf(input.credential)
      return input.settings
    },

    async topPages(days, limit) {
      const account = serviceAccountOf(input.credential)
      const property = input.settings.propertyId
      if (property === undefined) {
        throw new ProviderError('invalid', 'No GA4 property.', 'Pass settings.propertyId.')
      }
      const { status, body } = await request(
        input.fetch,
        'Google Analytics',
        `${GA4_DATA_API}/properties/${property}:runReport`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await accessToken(account)}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
            dimensions: [{ name: 'pagePath' }],
            metrics: [{ name: 'screenPageViews' }],
            dimensionFilter: {
              filter: { fieldName: 'hostName', inListFilter: { values: input.hosts } },
            },
            orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
            limit: rowsFor(limit),
          }),
        },
      )
      const message = () => messageOf(body, secrets(account))
      if (status === 401 || status === 403) {
        throw new ProviderError(
          'refused',
          message(),
          `Add ${account.clientEmail} as a Viewer of the property: in GA4, Admin, Property access management.`,
        )
      }
      if (status === 400 || status === 404) {
        throw new ProviderError(
          'invalid',
          message(),
          'Check settings.propertyId: the digits under Admin, Property details.',
        )
      }
      if (status !== 200) {
        throw new ProviderError(
          'unreachable',
          `Google Analytics answered ${status}.`,
          'Try again in a minute.',
        )
      }
      const rows = isRecord(body) && Array.isArray(body['rows']) ? body['rows'] : []
      return ranked(
        rows.flatMap((row) => {
          if (
            !isRecord(row) ||
            !Array.isArray(row['dimensionValues']) ||
            !Array.isArray(row['metricValues'])
          ) {
            return []
          }
          const dimension: unknown = row['dimensionValues'][0]
          const metric: unknown = row['metricValues'][0]
          const path = isRecord(dimension) ? dimension['value'] : undefined
          const views = isRecord(metric) ? Number(metric['value']) : Number.NaN
          return typeof path === 'string' ? [{ path, views }] : []
        }),
        limit,
      )
    },
  }
}
