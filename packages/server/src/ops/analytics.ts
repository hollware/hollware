import type { OperationHandler } from './types.ts'

/*
 * The analytics connection of a site (ADR-040): read, made and forgotten through the port, which
 * asks the provider, seals the credential and keeps the row. The handlers never see a request to a
 * provider, and never answer the credential.
 */

/** The connection without its credential, or `not_connected`. */
export const getAnalytics: OperationHandler<'get_analytics'> = async (_input, context) => {
  const connection = (await context.analytics?.connection(context.site.key)) ?? null
  if (connection === null) return { outcome: 'not_connected' }
  return {
    outcome: 'connected',
    provider: connection.provider,
    settings: connection.settings,
    connectedAt: connection.connectedAt,
    ...(connection.checkedAt === null ? {} : { checkedAt: connection.checkedAt }),
  }
}

/** Asks the provider with the credential, and saves the connection only when it answered. */
export const connectAnalytics: OperationHandler<'connect_analytics'> = async (input, context) => {
  const sources = context.analytics ?? null
  if (sources === null) return { outcome: 'unavailable' }
  if (input.provider === 'ga4' && input.settings?.propertyId === undefined) {
    return {
      outcome: 'invalid',
      message: 'GA4 needs the property to read.',
      fix: 'Pass settings.propertyId: the digits of the property id, in GA4 under Admin, Property details.',
    }
  }
  if (input.provider === 'cloudflare' && input.settings?.accountId === undefined) {
    return {
      outcome: 'invalid',
      message: 'Cloudflare needs the account to read.',
      fix: 'Pass settings.accountId: the 32 characters after dash.cloudflare.com/ in the address of the dashboard.',
    }
  }
  const result = await sources.connect(context.site, {
    provider: input.provider,
    credential: input.credential,
    settings: input.settings ?? {},
  })
  return result
}

/** Forgets the connection and its credential. */
export const disconnectAnalytics: OperationHandler<'disconnect_analytics'> = async (
  _input,
  context,
) => {
  const forgotten = (await context.analytics?.disconnect(context.site.key)) ?? false
  return { outcome: forgotten ? 'disconnected' : 'not_connected' }
}
