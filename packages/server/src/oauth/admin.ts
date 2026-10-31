import type { HollwareEnv } from '../index.ts'
import type { OAuth } from './server.ts'

const KEY = 'hollware:admin-client:'

export interface AdminClient {
  readonly clientId: string
  readonly redirectUri: string
}

export async function adminClient(oauth: OAuth, env: HollwareEnv): Promise<AdminClient> {
  const redirectUri = oauth.adminCallback
  const stored = await env.OAUTH_KV.get(`${KEY}${redirectUri}`)
  if (stored !== null) return { clientId: stored, redirectUri }
  const client = await oauth.authorizationServer.getOAuthApi(env).createClient({
    clientName: 'Hollware admin',
    redirectUris: [redirectUri],
    tokenEndpointAuthMethod: 'none',
  })
  await env.OAUTH_KV.put(`${KEY}${redirectUri}`, client.clientId)
  return { clientId: client.clientId, redirectUri }
}
