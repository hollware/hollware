// EXPERIMENT: the OAuth provider with the passkey Worker (src/index.ts) as its default handler,
// to size what ADR-005 sizes: "the OAuth provider plus SimpleWebAuthn". Never run.
import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import passkeys from '../../src/index.ts'

const api = { fetch: () => new Response('ok') }

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: api,
  defaultHandler: passkeys,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',
  resourceMetadata: {
    resource: 'https://cms.example.test/mcp',
    authorization_servers: ['https://cms.example.test'],
  },
})
