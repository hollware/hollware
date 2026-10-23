import { personActor, type AuditActor, type AuditLog, type AuditSite } from '../audit/log.ts'
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
import { findSession, membershipsOf, type Role } from '../identity/store.ts'
import type { Clock } from '../ports.ts'
import { adminClient } from './admin.ts'
import type { GrantProps, OAuth } from './server.ts'

export interface AuthorizeOptions {
  readonly sites: ReadonlySet<string>
  readonly clock: Clock
  readonly oauth: (publicUrl: string) => OAuth
  readonly site?: (c: Context<GatewayEnv>, key: string) => Promise<AuditSite | undefined>
  readonly audit?: (c: Context<GatewayEnv>, actor: AuditActor) => AuditLog
}

const BASELINE: readonly Scope[] = ['content:read']

export function grantableScopes(role: string, asked: readonly string[]): Scope[] {
  if (!isRole(role)) return []
  const scopes = asked.filter(isScope)
  return ROLE_SCOPES[role].filter((scope) => scopes.includes(scope))
}

function html(body: string, status = 200, extra?: Headers): Response {
  const headers = new Headers(plainPageHeaders())
  extra?.forEach((value, name) => {
    if (name.toLowerCase() === 'set-cookie') headers.append(name, value)
  })
  return new Response(body, { status, headers })
}

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

export function installAuthorize(app: Hono<GatewayEnv>, options: AuthorizeOptions): void {
  const person = async (c: Context<GatewayEnv>) => {
    const secret = getCookie(c, SESSION_COOKIE)
    if (secret === undefined) return null
    const db = connect(c.env.DB)
    const found = await findSession(db, secret, options.clock.now())
    if (found === null) return null
    const memberships = (await membershipsOf(db, found.userId)).filter((membership) =>
      options.sites.has(membership.site),
    )
    return { ...found, memberships }
  }
  const signIn = (c: Context<GatewayEnv>) => {
    const url = new URL(c.req.url)
    const back = `${url.pathname}${url.search}`
    return c.redirect(`/signin?return_to=${encodeURIComponent(back)}`, 302)
  }
  const notMember = (site: string | undefined) =>
    html(
      messagePage(
        'Not a member',
        site === undefined
          ? 'You are not a member of any site of this Hollware. Ask an owner for an invitation.'
          : `You are not a member of the site "${site}". Ask its owner for an invitation.`,
      ),
      403,
    )

  app.get('/authorize', async (c) => {
    const server = options.oauth(c.env.HOLLWARE_PUBLIC_URL)
    const oauth = server.authorizationServer.getOAuthApi(c.env)
    try {
      const request = await oauth.parseAuthRequest(c.req.raw)
      const signedIn = await person(c)
      if (signedIn === null) return signIn(c)
      const [first] = signedIn.memberships
      if (first === undefined) return notMember(undefined)
      const asked = c.req.query('site')
      const named =
        asked === undefined ? undefined : signedIn.memberships.find((m) => m.site === asked)
      if (asked !== undefined && named === undefined) return notMember(asked)
      if (request.clientId === (await adminClient(server, c.env)).clientId) {
        const membership = named ?? first
        const props: GrantProps = { userId: signedIn.userId, site: membership.site }
        const { redirectTo } = await oauth.completeAuthorization({
          request,
          userId: signedIn.userId,
          metadata: { site: membership.site },
          scope: grantableScopes(membership.role, request.scope),
          props,
        })
        return new Response(null, { status: 302, headers: { location: redirectTo } })
      }
      const choices: readonly { site: string; role: Role }[] =
        named !== undefined ? [named] : signedIn.memberships
      const asking = request.scope.length === 0 ? BASELINE : request.scope
      const scopes = [...new Set(choices.flatMap((m) => grantableScopes(m.role, asking)))]
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
          sites: choices.map((m) => m.site),
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
      const chosen = form.get('site')
      const membership = signedIn.memberships.find((m) => m.site === chosen)
      if (membership === undefined)
        return notMember(typeof chosen === 'string' ? chosen : undefined)
      const scope = grantableScopes(membership.role, form.getAll('scope').map(String))
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
      const props: GrantProps = { userId: signedIn.userId, site: membership.site }
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: signedIn.userId,
        metadata: { site: membership.site },
        scope,
        props,
      })
      const site = await options.site?.(c, membership.site)
      if (site !== undefined && options.audit !== undefined) {
        await options.audit(c, personActor(signedIn.userId)).write(site, {
          action: 'app.allow',
          outcome: 'ok',
          target: { type: 'client', id: approved.request.clientId },
          detail: { scopes: scope },
        })
      }
      approved.headers.set('location', redirectTo)
      return new Response(null, { status: 302, headers: approved.headers })
    } catch (error) {
      return answerError(error)
    }
  })
}
