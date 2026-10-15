import {
  generatePersonalToken,
  hashPersonalToken,
  isScope,
  newId,
  type Scope,
} from '@hollware/core'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import type { Context, Hono } from 'hono'
import { insufficientScope } from '../auth/index.ts'
import { isRole, ROLE_SCOPES } from '../auth/roles.ts'
import type { Principal } from '../auth/types.ts'
import { connect } from '../db/d1.ts'
import { invitations, members, tokens, users } from '../db/schema.ts'
import { createInvitation, membershipsOf } from '../identity/store.ts'
import { adminClient } from '../oauth/admin.ts'
import type { OAuth, Proceed } from '../oauth/server.ts'
import type { Clock } from '../ports.ts'
import type { GatewayEnv } from './types.ts'

/**
 * What only a person in the admin may do (ADR-026): see, make and revoke personal tokens, and
 * invite people, on the site of their token; and learn who they are and which sites they may switch
 * to (`/v1/admin/me`, the one route for every role). These are no operations, so no agent sees them over MCP, and a request needs an
 * access token of the admin's own client with `schema:admin`: a personal token, or a token of
 * another client, never reaches them, even an owner's. A leaked token cannot mint the next one.
 */

/** A personal token lasts this long unless the person says otherwise (as `hollware token create`). */
const TOKEN_DAYS = 90
const INVITATION_DAYS = 7

export interface AdminApiOptions {
  /** The sites of the deployment: the person may switch among those they are a member of. */
  readonly sites: ReadonlySet<string>
  readonly clock: Clock
  readonly oauth: (publicUrl: string) => OAuth
  readonly protect: (c: Context<GatewayEnv>, proceed: Proceed) => Promise<Response>
  readonly metadataUrl: (c: Context<GatewayEnv>) => string
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

function refused(message: string, fix: string, status: 400 | 403 | 404 = 400): Response {
  return json({ code: status === 400 ? 'invalid_input' : 'forbidden', message, fix }, status)
}

function parseScopes(json: string): Scope[] {
  try {
    const value: unknown = JSON.parse(json)
    return Array.isArray(value)
      ? value.filter((scope): scope is Scope => typeof scope === 'string' && isScope(scope))
      : []
  } catch {
    return []
  }
}

function daysFrom(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365
    ? value
    : null
}

export function installAdminApi(app: Hono<GatewayEnv>, options: AdminApiOptions): void {
  /**
   * Runs `handle` for a person in the admin with `schema:admin`, or with any scope when `anyone`;
   * anyone else is refused.
   */
  const admin =
    (
      handle: (
        c: Context<GatewayEnv>,
        person: Extract<Principal, { kind: 'oauth' }>,
      ) => Promise<Response>,
      { anyone = false }: { readonly anyone?: boolean } = {},
    ) =>
    (c: Context<GatewayEnv>) =>
      options.protect(c, async (principal) => {
        const ours = (await adminClient(options.oauth(c.env.HOLLWARE_PUBLIC_URL), c.env)).clientId
        if (principal.kind !== 'oauth' || principal.clientId !== ours) {
          return refused(
            'Only the admin may do this.',
            'Sign in to the admin at /admin/ and do it there.',
            403,
          )
        }
        if (!anyone && !principal.scopes.includes('schema:admin')) {
          return insufficientScope(['schema:admin'], options.metadataUrl(c))
        }
        return handle(c, principal)
      })

  const body = async (c: Context<GatewayEnv>): Promise<Record<string, unknown>> => {
    const value: unknown = await c.req.json().catch(() => null)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : {}
  }

  // Who is signed in, the site of the token, and the sites of the deployment the person may switch
  // to, with their role in each: what the admin needs to draw itself, for every role.
  app.get(
    '/v1/admin/me',
    admin(
      async (c, person) => {
        const db = connect(c.env.DB)
        const [user] = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, person.userId))
        const sites = (await membershipsOf(db, person.userId)).filter((membership) =>
          options.sites.has(membership.site),
        )
        return json({ user, site: person.site, scopes: person.scopes, sites })
      },
      { anyone: true },
    ),
  )

  app.get(
    '/v1/admin/tokens',
    admin(async (c, person) => {
      const rows = await connect(c.env.DB)
        .select({
          id: tokens.id,
          label: tokens.label,
          scopes: tokens.scopes,
          user: users.name,
          expiresAt: tokens.expiresAt,
          revokedAt: tokens.revokedAt,
          lastUsedAt: tokens.lastUsedAt,
          createdAt: tokens.createdAt,
        })
        .from(tokens)
        .innerJoin(users, eq(users.id, tokens.userId))
        .where(eq(tokens.siteId, person.site))
        .orderBy(desc(tokens.createdAt), desc(tokens.id))
      return json({ tokens: rows.map((row) => ({ ...row, scopes: parseScopes(row.scopes) })) })
    }),
  )

  app.post(
    '/v1/admin/tokens',
    admin(async (c, person) => {
      const input = await body(c)
      const label = typeof input['label'] === 'string' ? input['label'].trim() : ''
      if (label === '' || label.length > 100) {
        return refused(
          'A token needs a label of 1 to 100 characters.',
          'Say what the token is for.',
        )
      }
      const asked = Array.isArray(input['scopes'])
        ? input['scopes'].filter((s) => typeof s === 'string')
        : []
      // A token gets no more than the person who makes it may do.
      const scopes = person.scopes.filter((scope) => asked.includes(scope))
      if (scopes.length === 0) {
        return refused(
          'A token needs at least one scope that you have.',
          `Choose among ${person.scopes.join(', ')}.`,
        )
      }
      const days = daysFrom(input['expiresInDays'], TOKEN_DAYS)
      if (days === null)
        return refused(
          'expiresInDays is a whole number from 1 to 365.',
          'Leave it out for 90 days.',
        )
      const now = options.clock.now()
      const secret = generatePersonalToken()
      const row = {
        id: newId('tok'),
        siteId: person.site,
        userId: person.userId,
        label,
        hash: await hashPersonalToken(secret),
        scopes: JSON.stringify(scopes),
        expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
        revokedAt: null,
        lastUsedAt: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }
      await connect(c.env.DB).insert(tokens).values(row)
      return json({ id: row.id, label, scopes, expiresAt: row.expiresAt, secret }, 201)
    }),
  )

  app.post(
    '/v1/admin/tokens/:id/revoke',
    admin(async (c, person) => {
      const now = options.clock.now().toISOString()
      const db = connect(c.env.DB)
      const id = c.req.param('id') ?? ''
      const [revoked] = await db
        .update(tokens)
        .set({ revokedAt: now, updatedAt: now })
        .where(and(eq(tokens.siteId, person.site), eq(tokens.id, id), isNull(tokens.revokedAt)))
        .returning({ id: tokens.id })
      if (revoked !== undefined) return json({ id: revoked.id, revokedAt: now })
      const [row] = await db
        .select({ id: tokens.id, revokedAt: tokens.revokedAt })
        .from(tokens)
        .where(and(eq(tokens.siteId, person.site), eq(tokens.id, id)))
      return row === undefined
        ? refused('There is no such token.', 'List the tokens and pick one of them.', 404)
        : json({ id: row.id, revokedAt: row.revokedAt })
    }),
  )

  app.get(
    '/v1/admin/people',
    admin(async (c, person) => {
      const db = connect(c.env.DB)
      const now = options.clock.now().toISOString()
      const people = await db
        .select({ id: users.id, name: users.name, role: members.role, since: members.createdAt })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(eq(members.siteId, person.site))
        .orderBy(members.createdAt, users.id)
      const pending = await db
        .select({ id: invitations.id, role: invitations.role, expiresAt: invitations.expiresAt })
        .from(invitations)
        .where(
          and(
            eq(invitations.siteId, person.site),
            isNull(invitations.usedAt),
            isNull(invitations.userId),
            gt(invitations.expiresAt, now),
          ),
        )
        .orderBy(desc(invitations.createdAt))
      return json({ people, invitations: pending })
    }),
  )

  app.post(
    '/v1/admin/invitations',
    admin(async (c, person) => {
      const input = await body(c)
      const role = input['role']
      // An owner is made by `hollware init`; the admin invites editors and authors.
      if (typeof role !== 'string' || !isRole(role) || role === 'owner') {
        return refused(
          'An invitation is for an editor or an author.',
          `Use role "editor" (${ROLE_SCOPES.editor.join(', ')}) or "author" (${ROLE_SCOPES.author.join(', ')}).`,
        )
      }
      const days = daysFrom(input['days'], INVITATION_DAYS)
      if (days === null)
        return refused('days is a whole number from 1 to 365.', 'Leave it out for 7 days.')
      const made = await createInvitation(connect(c.env.DB), {
        site: person.site,
        role,
        userId: null,
        now: options.clock.now(),
        days,
      })
      const origin = options.oauth(c.env.HOLLWARE_PUBLIC_URL).issuer
      return json(
        {
          id: made.id,
          role,
          expiresAt: made.expiresAt,
          link: `${origin}/setup?invitation=${made.secret}`,
        },
        201,
      )
    }),
  )
}
