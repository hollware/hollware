import { isScope, type Scope } from '@hollware/core'
import {
  AuthorizationError,
  authorizationErrorRedirect,
  CimdFetchError,
} from '@cloudflare/workers-oauth-provider'
import type { Context, Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { isRole, ROLE_SCOPES } from '../auth/roles.ts'
import { connect } from '../db/d1.ts'
import type { GatewayEnv } from '../http/types.ts'
import { consentPage, messagePage, plainPageHeaders } from '../identity/pages.ts'
import { SESSION_COOKIE } from '../identity/routes.ts'
import { findSession } from '../identity/store.ts'
import type { Clock } from '../ports.ts'
import type { GrantProps, OAuth } from './server.ts'

export interface AuthorizeOptions {
  readonly site: string
  readonly clock: Clock
  readonly oauth: (publicUrl: string) => OAuth
}

/** What a client gets when it asks for no scope: the baseline that `/mcp` and `/v1` name. */
const BASELINE: readonly Scope[] = ['content:read']

/**
 * The scopes a person may grant: those asked for that the person's role allows, in the order of
 * the role. Anything that is not a scope of Hollware is left out.
 */
export function grantableScopes(role: string, asked: readonly string[]): Scope[] {
  if (!isRole(role)) return []
  const scopes = asked.filter(isScope)
  return ROLE_SCOPES[role].filter((scope) => scopes.includes(scope))
}

function html(body: string, status = 200, extra?: Headers): Response {
  const headers = new Headers(plainPageHeaders())
  extra?.forEach((value, name) => {
    // The consent helpers' cookies bind the form to this browser; their other headers are ours.
    if (name.toLowerCase() === 'set-cookie') headers.append(name, value)
  })
  return new Response(body, { status, headers })
}

/**
 * An error of the authorization endpoint, as the consent page guide says: a redirect back to the
 * client only when the library validated the client and its exact redirect URI, and a page of our
 * own otherwise. Anything else is a bug or an outage, and goes on to the error handler.
 */
function answerError(error: unknown): Response {
  if (error instanceof AuthorizationError && error.redirectTo !== undefined) {
    return new Response(null, { status: 302, headers: { location: error.redirectTo } })
  }
  if (error instanceof AuthorizationError) {
    return html(messagePage('This request cannot go on', error.description), 400)
  }
  if (error instanceof CimdFetchError) {
    return html(
      messagePage(
        'This app could not be verified',
        'Its metadata document could not be fetched or is not valid. Try again later, or ask its developer.',
      ),
      400,
    )
  }
  throw error
}

/**
 * The authorization endpoint of the OAuth server (ADR-026), which is Hollware's page and not the
 * library's: the library parses and validates the request, and this page signs the person in,
 * shows what the client asks for, and completes the authorization with what the person allowed.
 *
 * - A person without a session is sent to `/signin`, which comes back here once they are in. The
 *   session cookie is only sent to `/authorize`.
 * - The page offers the scopes the client asked for that the person's role allows, each checked;
 *   the person may untick any. A request that would get no scope at all is refused with
 *   `access_denied`.
 * - The grant stores the person and the site. What its tokens may do is read again on each request
 *   against the person's role then (`server.ts`).
 */
export function installAuthorize(app: Hono<GatewayEnv>, options: AuthorizeOptions): void {
  const person = async (c: Context<GatewayEnv>) => {
    const secret = getCookie(c, SESSION_COOKIE)
    if (secret === undefined) return null
    return await findSession(connect(c.env.DB), options.site, secret, options.clock.now())
  }
  const signIn = (c: Context<GatewayEnv>) => {
    const url = new URL(c.req.url)
    const back = `${url.pathname}${url.search}`
    return c.redirect(`/signin?return_to=${encodeURIComponent(back)}`, 302)
  }

  app.get('/authorize', async (c) => {
    const oauth = options.oauth(c.env.HOLLWARE_PUBLIC_URL).authorizationServer.getOAuthApi(c.env)
    try {
      const request = await oauth.parseAuthRequest(c.req.raw)
      const signedIn = await person(c)
      if (signedIn === null) return signIn(c)
      const scopes = grantableScopes(
        signedIn.role,
        request.scope.length === 0 ? BASELINE : request.scope,
      )
      if (scopes.length === 0) {
        const location = authorizationErrorRedirect(
          request,
          'access_denied',
          'Your role allows none of the scopes this client asked for.',
        )
        return new Response(null, { status: 302, headers: { location } })
      }
      const details = await oauth.describeConsent(request)
      const consent = await oauth.beginConsent(request)
      return html(
        consentPage({
          clientName: details.clientName,
          clientDomain: details.clientDomain,
          redirectHost: details.redirectHost,
          redirectIsLoopback: details.redirectIsLoopback,
          person: signedIn.name ?? 'you',
          scopes,
          handle: consent.handle,
        }),
        200,
        consent.headers,
      )
    } catch (error) {
      return answerError(error)
    }
  })

  app.post('/authorize', async (c) => {
    const oauth = options.oauth(c.env.HOLLWARE_PUBLIC_URL).authorizationServer.getOAuthApi(c.env)
    try {
      const signedIn = await person(c)
      if (signedIn === null) {
        return html(
          messagePage('Your session ended', 'Sign in again, then start from the app.'),
          401,
        )
      }
      const form = await c.req.formData()
      const value = form.get('handle')
      const handle = typeof value === 'string' ? value : ''
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(c.req.raw, handle)
        return new Response(null, { status: 302, headers: denied.headers })
      }
      const scope = grantableScopes(signedIn.role, form.getAll('scope').map(String))
      const approved = await oauth.approveConsent(c.req.raw, handle, { scope })
      if (scope.length === 0) {
        const location = authorizationErrorRedirect(
          approved.request,
          'access_denied',
          'No scope was allowed.',
        )
        approved.headers.set('location', location)
        return new Response(null, { status: 302, headers: approved.headers })
      }
      const props: GrantProps = { userId: signedIn.userId, site: options.site }
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: signedIn.userId,
        metadata: { site: options.site },
        scope,
        props,
      })
      approved.headers.set('location', redirectTo)
      return new Response(null, { status: 302, headers: approved.headers })
    } catch (error) {
      return answerError(error)
    }
  })
}
