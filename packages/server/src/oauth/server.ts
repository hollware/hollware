import { isPersonalToken, isScope, SCOPES } from '@hollware/core'
import {
  OAuthAuthorizationServer,
  OAuthResourceServer,
  type OAuthResourceAuth,
} from '@cloudflare/workers-oauth-provider'
import { effectiveScopes } from '../auth/roles.ts'
import { checkPersonalToken, type TokenRejection } from '../auth/token.ts'
import type { RequestPrincipal } from '../auth/types.ts'
import type { OAuthErrorLog } from '../http/types.ts'
import type { HollwareEnv } from '../index.ts'
import type { Clock } from '../ports.ts'

/** Access tokens live an hour, and a grant thirty days from its code, refreshed or not (ADR-026). */
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

/** What a grant stores, encrypted, and what its access tokens unwrap: whose it is, and where. */
export interface GrantProps {
  readonly userId: string
  readonly site: string
}

/** The two protected resources of a Hollware: MCP and the read API. */
export type ResourceName = 'mcp' | 'v1'

/** Why a token presented to a resource is refused: for the log, never for the answer. */
export type Refusal = TokenRejection | 'no_user' | 'other_site'

/** What a protected route does once its token is accepted. */
export type Proceed = (principal: RequestPrincipal, auth: OAuthResourceAuth) => Promise<Response>

/** The request of a protected route, as the gateway hands it to the resource server. */
interface Pending {
  readonly proceed: Proceed
  readonly refused: (reason: Refusal) => void
  /** Hands a write that must outlive the answer to `ctx.waitUntil`. */
  readonly defer: (promise: Promise<void>) => void
  /**
   * Keeps what the validator threw, such as a D1 failure. The library would answer it as a bare
   * 503; the gateway throws it again, so it ends as every other failure does: a JSON 500 with the
   * id of the request, and the cause in the log.
   */
  readonly failed: (error: unknown) => void
}

export interface OAuthOptions {
  /** The sites this deployment serves; a grant or a token of any other is refused. */
  readonly sites: ReadonlySet<string>
  readonly clock: Clock
  /** Whether clients may register themselves (RFC 7591), from `auth` of the config. */
  readonly dynamicClientRegistration: boolean
  readonly log: (entry: OAuthErrorLog) => void
}

/** The OAuth server of one public URL, and its two resources. */
export interface OAuth {
  readonly issuer: string
  readonly authorizationServer: OAuthAuthorizationServer<HollwareEnv>
  /** The canonical URL of each resource: its tokens' audience. */
  readonly resources: Readonly<Record<ResourceName, string>>
  /** The protected resource metadata of each resource (RFC 9728). */
  readonly metadataUrls: Readonly<Record<ResourceName, string>>
  /**
   * Runs a protected route: the resource server answers its metadata, a request without a token,
   * and a token it refuses, and calls `proceed` with the principal of a token it accepts.
   */
  readonly protect: (
    resource: ResourceName,
    request: Request,
    env: HollwareEnv,
    ctx: ExecutionContext,
    pending: Pending,
  ) => Promise<Response>
}

/** The role of a member of the site, read on every request: a change of role takes effect at once. */
async function roleOf(db: D1Database, site: string, userId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT role FROM members WHERE site_id = ?1 AND user_id = ?2')
    .bind(site, userId)
    .first<{ role: string }>()
  return row?.role ?? null
}

function isGrantProps(value: unknown): value is GrantProps {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'userId') === 'string' &&
    typeof Reflect.get(value, 'site') === 'string'
  )
}

/**
 * Builds the OAuth server of a deployment (ADR-026), once for each public URL it is asked about:
 * the issuer and the resources are that URL's, and the Worker learns it from its environment, on
 * the first request. One Worker holds both roles: an `OAuthAuthorizationServer`, whose
 * `/authorize` is Hollware's own page (`authorize.ts`), and an `OAuthResourceServer` for `/mcp`
 * and for `/v1`.
 *
 * A resource accepts two kinds of token, told apart by their shape. A personal token
 * (`hw_pat_…`) is looked up in D1 as before, and never reaches the OAuth server; any other token
 * is the OAuth server's to validate, for that resource alone. Either way the principal's scopes
 * are what the token carries intersected with what the user's role allows now.
 */
export function createOAuth(options: OAuthOptions): (publicUrl: string) => OAuth {
  const built = new Map<string, OAuth>()
  return (publicUrl) => {
    const issuer = new URL(publicUrl).origin
    const existing = built.get(issuer)
    if (existing !== undefined) return existing
    const oauth = build(issuer, options)
    built.set(issuer, oauth)
    return oauth
  }
}

function build(issuer: string, options: OAuthOptions): OAuth {
  const resources = { mcp: `${issuer}/mcp`, v1: `${issuer}/v1` } as const
  const metadataUrls = {
    mcp: `${issuer}/.well-known/oauth-protected-resource/mcp`,
    v1: `${issuer}/.well-known/oauth-protected-resource/v1`,
  } as const
  const authorizationServer = new OAuthAuthorizationServer<HollwareEnv>({
    issuer,
    resources: [resources.mcp, resources.v1],
    scopesSupported: [...SCOPES],
    accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTTL: REFRESH_TOKEN_TTL_SECONDS,
    clientIdMetadataDocumentEnabled: true,
    ...(options.dynamicClientRegistration ? { clientRegistrationEndpoint: '/oauth/register' } : {}),
    onError: ({ code, internal }) => {
      options.log({ kind: 'oauth_error', code, reason: internal?.reason ?? null })
    },
  })

  /** The protected routes in flight, by their request: the resource server hands it on as it is. */
  const pending = new WeakMap<Request, Pending>()

  const validate =
    (env: HollwareEnv, request: Request) => async (resource: string, token: string) => {
      try {
        return await check(env, request, resource, token)
      } catch (error) {
        pending.get(request)?.failed(error)
        throw error
      }
    }

  const check = async (env: HollwareEnv, request: Request, resource: string, token: string) => {
    const refuse = (reason: Refusal) => {
      pending.get(request)?.refused(reason)
      return null
    }
    if (isPersonalToken(token)) {
      const check = await checkPersonalToken(env.DB, token, {
        sites: options.sites,
        now: options.clock.now(),
      })
      if (!check.ok) return refuse(check.reason)
      // At most once an hour, and it never rejects: after the answer, not before it.
      if (check.touch !== null) {
        const route = pending.get(request)
        if (route === undefined) await check.touch
        else route.defer(check.touch)
      }
      return { props: check.principal, audience: resource, scope: [...check.principal.scopes] }
    }
    const granted = await authorizationServer.validateToken<unknown>(resource, token, env)
    if (granted === null) return refuse('unknown')
    if (!isGrantProps(granted.props)) return refuse('unknown')
    const site = granted.props.site
    if (!options.sites.has(site)) return refuse('other_site')
    const role = await roleOf(env.DB, site, granted.props.userId)
    if (role === null) return refuse('no_user')
    const principal: RequestPrincipal = {
      kind: 'oauth',
      userId: granted.props.userId,
      clientId: granted.clientId,
      site,
      scopes: effectiveScopes(role, granted.scope.filter(isScope)),
    }
    return {
      props: principal,
      audience: granted.audience,
      expiresAt: granted.expiresAt,
      scope: [...principal.scopes],
      userId: principal.userId,
      clientId: principal.clientId,
    }
  }

  const resourceServer = (name: ResourceName) =>
    new OAuthResourceServer<HollwareEnv, RequestPrincipal>({
      resourceMetadata: {
        resource: resources[name],
        authorization_servers: [issuer],
        resource_name: name === 'mcp' ? 'Hollware MCP' : 'Hollware read API',
      },
      requiredScopes: ['content:read'],
      validateToken: validate,
      handler: {
        fetch: async (request, _env, ctx) => {
          const route = pending.get(request)
          if (route === undefined) {
            throw new Error('A protected route was reached without the gateway in front of it')
          }
          return await route.proceed(ctx.props, ctx.auth)
        },
      },
    })
  const servers = { mcp: resourceServer('mcp'), v1: resourceServer('v1') }

  return {
    issuer,
    authorizationServer,
    resources,
    metadataUrls,
    protect: async (resource, request, env, ctx, route) => {
      pending.set(request, route)
      try {
        return await servers[resource].fetch(request, env, ctx)
      } finally {
        pending.delete(request)
      }
    },
  }
}
