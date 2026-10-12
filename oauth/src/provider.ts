import {
  ExternalTokenError,
  OAuthProvider,
  type OAuthProviderOptions,
} from '@cloudflare/workers-oauth-provider'
import { apiHandler } from './api.ts'
import { app } from './app.ts'
import { BASELINE_SCOPES, SCOPES_SUPPORTED, type AuthProps } from './auth.ts'
import { checkPersonalToken } from './personal-token.ts'

/** One structured line per OAuth error the provider answers: which check failed, never why in detail. */
function logOAuthError(error: {
  code: string
  status: number
  internal: { category: string; reason: string }
}): void {
  console.warn(
    JSON.stringify({
      event: 'oauth.error',
      code: error.code,
      status: error.status,
      category: error.internal.category,
      reason: error.internal.reason,
    }),
  )
}

/**
 * The options of the whole Worker as one OAuthProvider: it serves the OAuth endpoints and the
 * metadata, guards the API routes and hands everything else to the Hono app.
 */
export function providerOptions(publicUrl: string): OAuthProviderOptions<Env> {
  const base = publicUrl.replace(/\/+$/, '')

  return {
    // One resource for the whole origin. With `${base}/mcp` as the resource, `/v1/` could not be
    // a protected route: the constructor throws.
    apiRoute: ['/mcp', '/v1/'],
    apiHandler,
    defaultHandler: app,
    // Absolute URLs, so the issuer and every endpoint come from the configured public URL. With
    // paths ('/oauth/token') the issuer would be the origin of each request.
    authorizeEndpoint: `${base}/authorize`,
    tokenEndpoint: `${base}/oauth/token`,
    clientRegistrationEndpoint: `${base}/oauth/register`,
    scopesSupported: SCOPES_SUPPORTED,
    resourceMetadata: {
      resource: base,
      authorization_servers: [base],
      resource_name: 'Hollware spike',
    },
    requiredScopes: BASELINE_SCOPES,
    clientIdMetadataDocumentEnabled: true,
    // Runs only for a bearer token that is not in this provider's own format and not in its KV.
    resolveExternalToken: async ({ token }) => {
      const check = await checkPersonalToken(token, Math.floor(Date.now() / 1000))
      if (check.kind === 'valid') {
        const props: AuthProps = {
          userId: check.token.userId,
          scopes: check.token.scopes,
          via: 'pat',
          tokenId: check.token.id,
        }
        return { props, audience: base }
      }
      if (check.reason === 'unknown') return null
      throw new ExternalTokenError('invalid_token', {
        description: `Personal token ${check.reason}`,
        statusCode: 401,
      })
    },
    onError: logOAuthError,
  }
}

export function createProvider(publicUrl: string): OAuthProvider<Env> {
  return new OAuthProvider<Env>(providerOptions(publicUrl))
}
