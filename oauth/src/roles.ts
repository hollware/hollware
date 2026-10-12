import {
  OAuthAuthorizationServer,
  OAuthError,
  OAuthResourceServer,
  type OAuthResourceTokenValidation,
} from '@cloudflare/workers-oauth-provider'
import { Hono } from 'hono'
import { handleApi } from './api.ts'
import { approve } from './approve.ts'
import { BASELINE_SCOPES, SCOPES_SUPPORTED, effectiveScopes, type AuthProps } from './auth.ts'
import { checkPersonalToken } from './personal-token.ts'

type Dispatcher = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) => Response | Promise<Response>

/**
 * The second topology: the authorization server and each protected resource are separate objects
 * in one Worker, and the Worker routes between them. `/mcp` and `/v1` are two resources, so a
 * token is bound to one of them.
 */
export function createRoles(publicUrl: string): Dispatcher {
  const base = publicUrl.replace(/\/+$/, '')
  const mcpResource = `${base}/mcp`
  const apiResource = `${base}/v1`

  const authorizationServer = new OAuthAuthorizationServer<Env>({
    issuer: base,
    resources: [mcpResource, apiResource],
    scopesSupported: SCOPES_SUPPORTED,
    clientRegistrationEndpoint: `${base}/oauth/register`,
    clientIdMetadataDocumentEnabled: true,
  })

  // The one hook for every resource: a personal token is checked against its table, anything else
  // is an access token of this authorization server.
  const validateToken =
    (env: Env) =>
    async (
      resource: string,
      token: string,
    ): Promise<OAuthResourceTokenValidation<AuthProps> | null> => {
      if (!token.startsWith('hw_pat_')) {
        const validated = await authorizationServer.validateToken<AuthProps>(resource, token, env)
        if (validated === null) return null
        // Effective scopes = token ∩ the current role of its user, on every request.
        return { ...validated, scope: effectiveScopes(validated.userId, validated.scope) }
      }
      const check = await checkPersonalToken(token, Math.floor(Date.now() / 1000))
      if (check.kind === 'valid') {
        return {
          props: {
            userId: check.token.userId,
            scopes: check.token.scopes,
            via: 'pat',
            tokenId: check.token.id,
          },
          audience: resource,
          scope: effectiveScopes(check.token.userId, check.token.scopes),
          userId: check.token.userId,
          clientId: `pat:${check.token.id}`,
          ...(check.token.expiresAt === null ? {} : { expiresAt: check.token.expiresAt }),
        }
      }
      if (check.reason === 'unknown') return null
      throw new OAuthError('invalid_token', {
        description: `Personal token ${check.reason}`,
        statusCode: 401,
      })
    }

  const mcp = new OAuthResourceServer<Env, AuthProps>({
    resourceMetadata: {
      resource: mcpResource,
      authorization_servers: [base],
      resource_name: 'Hollware spike MCP',
    },
    requiredScopes: BASELINE_SCOPES,
    validateToken,
    handler: { fetch: (request, _env, ctx) => handleApi(request, ctx, ctx.auth.scope) },
  })

  const api = new OAuthResourceServer<Env, AuthProps>({
    resourceMetadata: {
      resource: apiResource,
      authorization_servers: [base],
      resource_name: 'Hollware spike HTTP API',
    },
    requiredScopes: BASELINE_SCOPES,
    validateToken,
    handler: { fetch: (request, _env, ctx) => handleApi(request, ctx, ctx.auth.scope) },
  })

  // What is left for Hono: the public routes and the authorization endpoint the application owns.
  const app = new Hono<{ Bindings: Env }>()
  app.get('/', (c) => c.json({ name: 'hollware-spike-oauth-roles', public: true }))
  app.get('/runtime', (c) =>
    c.json({
      nodejsCompat: Cloudflare.compatibilityFlags.nodejs_compat,
      nodejsCompatV2: Cloudflare.compatibilityFlags.nodejs_compat_v2,
      globalFetchStrictlyPublic: Cloudflare.compatibilityFlags.global_fetch_strictly_public,
      hasProcess: Reflect.has(globalThis, 'process'),
      hasBuffer: Reflect.has(globalThis, 'Buffer'),
    }),
  )
  app.get('/authorize', async (c) => {
    const approval = await approve(authorizationServer.getOAuthApi(c.env), c.req.raw)
    return 'redirectTo' in approval
      ? c.redirect(approval.redirectTo)
      : c.text(approval.message, approval.status)
  })

  // Hono 5's ExecutionContext is a smaller interface than the one of the Workers types, so
  // `c.executionCtx` cannot be handed to the provider objects without a cast. Route before Hono
  // instead and pass the real context.
  return (request, env, ctx) => {
    const { pathname } = new URL(request.url)
    const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    if (pathname === '/.well-known/oauth-authorization-server' || under('/oauth')) {
      return authorizationServer.fetch(request, env, ctx)
    }
    if (pathname === '/.well-known/oauth-protected-resource/mcp' || under('/mcp')) {
      return mcp.fetch(request, env, ctx)
    }
    if (pathname === '/.well-known/oauth-protected-resource/v1' || under('/v1')) {
      return api.fetch(request, env, ctx)
    }
    return app.fetch(request, env, ctx)
  }
}

const dispatchers = new Map<string, Dispatcher>()

function dispatcherFor(publicUrl: string): Dispatcher {
  const existing = dispatchers.get(publicUrl)
  if (existing !== undefined) return existing
  const created = createRoles(publicUrl)
  dispatchers.set(publicUrl, created)
  return created
}

export default {
  fetch(request, env, ctx) {
    return dispatcherFor(env.HOLLWARE_PUBLIC_URL)(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
