// EXPERIMENT: only @cloudflare/workers-oauth-provider, to size it. Never run.
import { OAuthProvider } from '@cloudflare/workers-oauth-provider'

const handler = { fetch: () => new Response('ok') }

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: handler,
  defaultHandler: handler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',
  resourceMetadata: {
    resource: 'https://cms.example.test/mcp',
    authorization_servers: ['https://cms.example.test'],
  },
})
