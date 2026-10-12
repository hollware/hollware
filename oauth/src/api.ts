import { insufficientScope, type OAuthResourceContext } from '@cloudflare/workers-oauth-provider'
import type { AuthProps } from './auth.ts'

/**
 * Scope policy lives in the handler: the provider advertises `requiredScopes` in its metadata
 * and challenge, but it never enforces a scope on a route.
 */
export function scopesNeeded(method: string, pathname: string): string[] {
  if (method === 'GET' || method === 'HEAD') return ['content:read']
  if (pathname === '/v1/publish') return ['content:read', 'content:publish']
  return ['content:read', 'content:write']
}

/** OAuthProvider types `ctx` as a plain ExecutionContext, but sets `ctx.auth` before the call. */
export function hasAuthContext(ctx: ExecutionContext): ctx is OAuthResourceContext<AuthProps> {
  return 'auth' in ctx && typeof ctx.auth === 'object' && ctx.auth !== null
}

/**
 * What both the `/mcp` and the `/v1/` routes do in the spike: check the scopes the request carries
 * (`granted`, which each topology works out) and echo what the handler saw.
 */
export function handleApi(
  request: Request,
  ctx: OAuthResourceContext<AuthProps>,
  granted: string[],
): Response {
  const { pathname } = new URL(request.url)
  const needed = scopesNeeded(request.method, pathname)
  if (needed.some((scope) => !granted.includes(scope))) return insufficientScope(ctx.auth, needed)

  return Response.json({
    handler: pathname.startsWith('/v1') ? 'v1' : 'mcp',
    method: request.method,
    path: pathname,
    props: ctx.props,
    auth: {
      audience: ctx.auth.audience,
      scope: ctx.auth.scope,
      userId: ctx.auth.userId ?? null,
      clientId: ctx.auth.clientId ?? null,
    },
  })
}

export const apiHandler = {
  fetch(request, _env, ctx) {
    if (!hasAuthContext(ctx)) return new Response('missing auth context', { status: 500 })
    // An external token (a personal token) has no `ctx.auth.scope` here: its scopes are in the props.
    const granted = ctx.props.via === 'pat' ? ctx.props.scopes : ctx.auth.scope
    return handleApi(request, ctx, granted)
  },
} satisfies ExportedHandler<Env>
