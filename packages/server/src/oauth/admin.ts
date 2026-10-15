import type { HollwareEnv } from '../index.ts'
import type { OAuth } from './server.ts'

/**
 * The admin as a client of the OAuth server (ADR-026): a public client, with PKCE, that a person
 * never has to allow. It is registered once per issuer, with `createClient`, and its id is kept in
 * `OAUTH_KV` beside the library's own records. A Client ID Metadata Document would need an `https`
 * URL that the Worker fetches from itself, which local development does not have.
 */

/** Where the admin's id is kept, by issuer. The library's own keys never start with it. */
const KEY = 'hollware:admin-client:'

export interface AdminClient {
  readonly clientId: string
  readonly redirectUri: string
}

/**
 * The admin's client, registered on first use. Two first requests at once may both register one:
 * the last id written wins, and the other client is never used.
 */
export async function adminClient(oauth: OAuth, env: HollwareEnv): Promise<AdminClient> {
  const redirectUri = `${oauth.issuer}/admin/callback`
  const stored = await env.OAUTH_KV.get(`${KEY}${oauth.issuer}`)
  if (stored !== null) return { clientId: stored, redirectUri }
  const client = await oauth.authorizationServer.getOAuthApi(env).createClient({
    clientName: 'Hollware admin',
    redirectUris: [redirectUri],
    tokenEndpointAuthMethod: 'none',
  })
  await env.OAUTH_KV.put(`${KEY}${oauth.issuer}`, client.clientId)
  return { clientId: client.clientId, redirectUri }
}
