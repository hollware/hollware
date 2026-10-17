import {
  generatePersonalToken,
  generateReadToken,
  hashPersonalToken,
  isScope,
  newId,
  type Scope,
} from '@hollware/core'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import type { Context, Hono } from 'hono'
import { insufficientScope } from '../auth/index.ts'
import { isRole, ROLE_SCOPES } from '../auth/roles.ts'
import { removeMember, setRole, type PeopleChange } from '../identity/people.ts'
import type { Principal, RequestPrincipal } from '../auth/types.ts'
import type { AuditAction } from '@hollware/core'
import type { AuditLine, AuditSite } from '../audit/log.ts'
import type { AuditLogFor } from '../mcp/index.ts'
import { connect } from '../db/d1.ts'
import { invitations, members, tokens, users } from '../db/schema.ts'
import {
  createInvitation,
  endSessions,
  membershipsOf,
  passkeySummaries,
  removePasskey,
} from '../identity/store.ts'
import { adminClient } from '../oauth/admin.ts'
import {
  ACTIVITY_CSV_COLUMNS,
  ActivityInputError,
  activityCsvRow,
  readActivity,
  type ActivityFilters,
} from '../audit/read.ts'
import type { OAuth, Proceed } from '../oauth/server.ts'
import type { Clock } from '../ports.ts'
import type { GatewayEnv } from './types.ts'
import type { GrantSummary, OAuthHelpers } from '@cloudflare/workers-oauth-provider'

/**
 * What only a person in the admin may do (ADR-026): see, make and revoke personal tokens, and
 * invite people, on the site of their token; and learn who they are and which sites they may switch
 * to (`/v1/admin/me`), and manage their own sign-in (`/v1/admin/account`: their passkeys, the apps
 * they connected and their sessions), the routes for every role. These are no operations, so no agent sees them over MCP, and a request needs an
 * access token of the admin's own client with `schema:admin`: a personal token, or a token of
 * another client, never reaches them, even an owner's. A leaked token cannot mint the next one.
 */

const INVITATION_DAYS = 7
/** The lines of a page of the activity log, unless the admin asks for another number. */
const ACTIVITY_PAGE = 50
/** The most lines one CSV of the activity log holds. */
const ACTIVITY_CSV_MAX = 10_000

export interface AdminApiOptions {
  /** The sites of the deployment: the person may switch among those they are a member of. */
  readonly sites: ReadonlySet<string>
  /** A site of the deployment as the activity log needs it, or `undefined` when it serves none. */
  readonly site: (key: string) => AuditSite | undefined
  /** The activity log of a request (ADR-037), for the person of the admin. */
  readonly audit: (c: Context<GatewayEnv>, principal: RequestPrincipal) => Promise<AuditLogFor>
  readonly clock: Clock
  readonly oauth: (publicUrl: string) => OAuth
  readonly protect: (c: Context<GatewayEnv>, proceed: Proceed) => Promise<Response>
  readonly metadataUrl: (c: Context<GatewayEnv>) => string
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/** The code of each refusal: what the input breaks, who may not, what is not there, what clashes. */
const REFUSAL_CODES = {
  400: 'invalid_input',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
} as const

/** The code of a refusal by its status, for the activity log. */
function refusalCode(status: number): string {
  return status === 403 || status === 404 || status === 409 ? REFUSAL_CODES[status] : 'internal'
}

/** What a route that changed something says of it, for its line of the activity log. */
interface AuditNote {
  target?: { readonly type: string; readonly id: string }
  detail?: Readonly<Record<string, unknown>>
}

function refused(message: string, fix: string, status: 400 | 403 | 404 | 409 = 400): Response {
  return json({ code: REFUSAL_CODES[status], message, fix }, status)
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

/** The days an invitation lasts: `fallback` when left out, a whole number from 1 to 365, or null. */
function invitationDays(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365
    ? value
    : null
}

/**
 * The days a token lasts: none (`null`) when they are left out, so it never expires (T-26: the
 * person chooses), or a whole number from 1 to 365; `undefined` for anything else.
 */
function daysFrom(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365
    ? value
    : undefined
}

/** At most this many grants of a person are read: pages of the library's listing, 100 each. */
const GRANT_PAGES = 10

/** Every grant of a person, across the sites of the deployment. */
async function grantsOf(helpers: OAuthHelpers, userId: string): Promise<GrantSummary[]> {
  const grants: GrantSummary[] = []
  let cursor: string | undefined
  for (let page = 0; page < GRANT_PAGES; page++) {
    const listed = await helpers.listUserGrants(userId, {
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    })
    grants.push(...listed.items)
    cursor = listed.cursor
    if (cursor === undefined) break
  }
  return grants
}

/** The name a client gave itself, or its id when it gave none or cannot be read now. */
async function clientName(helpers: OAuthHelpers, clientId: string): Promise<string> {
  try {
    return (await helpers.lookupClient(clientId))?.clientName ?? clientId
  } catch {
    // A client of a metadata document whose document cannot be fetched now: its id is a URL.
    return clientId
  }
}

function siteOf(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const site: unknown = Reflect.get(metadata, 'site')
  return typeof site === 'string' ? site : null
}

export function installAdminApi(app: Hono<GatewayEnv>, options: AdminApiOptions): void {
  /**
   * Runs `handle` for a person in the admin with `schema:admin`, or with any scope when `anyone`;
   * anyone else is refused. A route that changes something names its `action`, and gets one line
   * of the activity log for each answer but a 400 (ADR-037): `ok` with what `handle` noted, `denied`
   * for a 403, `failed` for a 404 or a 409. A change of the person's own sign-in (`everySite`) is a
   * line in each site they are a member of, since a person is of the deployment.
   */
  const admin =
    (
      action: AuditAction | null,
      handle: (
        c: Context<GatewayEnv>,
        person: Extract<Principal, { kind: 'oauth' }>,
        note: AuditNote,
      ) => Promise<Response>,
      {
        anyone = false,
        everySite = false,
      }: { readonly anyone?: boolean; readonly everySite?: boolean } = {},
    ) =>
    (c: Context<GatewayEnv>) =>
      options.protect(c, async (principal) => {
        const note: AuditNote = {}
        const answer = await (async () => {
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
          return handle(c, principal, note)
        })()
        if (action !== null && answer.status !== 400 && principal.kind !== 'read') {
          const keys = everySite
            ? (await membershipsOf(connect(c.env.DB), principal.userId)).map((m) => m.site)
            : [principal.site]
          const log = (await options.audit(c, principal))(null)
          const line: AuditLine = {
            action,
            outcome: answer.ok ? 'ok' : answer.status === 403 ? 'denied' : 'failed',
            errorCode: answer.ok
              ? null
              : answer.status === 403 && answer.headers.has('www-authenticate')
                ? 'insufficient_scope'
                : refusalCode(answer.status),
            target: note.target ?? null,
            detail: note.detail ?? null,
          }
          for (const key of new Set(keys)) {
            const site = options.site(key)
            if (site !== undefined) await log.write(site, line)
          }
        }
        return answer
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
      null,
      async (c, person) => {
        const db = connect(c.env.DB)
        const [user] = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, person.userId))
        const memberships = await membershipsOf(db, person.userId)
        const sites = memberships.filter((membership) => options.sites.has(membership.site))
        // The sites in the trash the person owns, which they may bring back (ADR-033).
        const { results: trashed } = await c.env.DB.prepare(
          'SELECT id, deleted_at FROM sites WHERE deleted_at IS NOT NULL',
        ).all<{ id: string; deleted_at: string }>()
        const owned = new Set(
          memberships.filter((membership) => membership.role === 'owner').map((m) => m.site),
        )
        const trash = trashed
          .filter((row) => owned.has(row.id))
          .map((row) => ({ site: row.id, deletedAt: row.deleted_at }))
        return json({ user, site: person.site, scopes: person.scopes, sites, trash })
      },
      { anyone: true },
    ),
  )

  app.get(
    '/v1/admin/tokens',
    admin(null, async (c, person) => {
      const rows = await connect(c.env.DB)
        .select({
          id: tokens.id,
          kind: tokens.kind,
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
    admin('token.create', async (c, person, note) => {
      const input = await body(c)
      const label = typeof input['label'] === 'string' ? input['label'].trim() : ''
      if (label === '' || label.length > 100) {
        return refused(
          'A token needs a label of 1 to 100 characters.',
          'Say what the token is for.',
        )
      }
      const asKind = input['kind']
      const kind: 'personal' | 'read' | null =
        asKind === undefined || asKind === 'personal'
          ? 'personal'
          : asKind === 'read'
            ? 'read'
            : null
      if (kind === null) {
        return refused(
          'kind is "personal" or "read".',
          'Leave it out for a personal token; "read" makes a token that reads published content.',
        )
      }
      // A read token reads, whatever it asks for.
      const asked =
        kind === 'read'
          ? ['content:read']
          : Array.isArray(input['scopes'])
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
      const days = daysFrom(input['expiresInDays'])
      if (days === undefined)
        return refused(
          'expiresInDays is a whole number from 1 to 365.',
          'Leave it out for a token that never expires.',
        )
      const now = options.clock.now()
      const secret = kind === 'read' ? generateReadToken() : generatePersonalToken()
      const row = {
        id: newId('tok'),
        kind,
        siteId: person.site,
        userId: person.userId,
        label,
        hash: await hashPersonalToken(secret),
        scopes: JSON.stringify(scopes),
        expiresAt: days === null ? null : new Date(now.getTime() + days * 86_400_000).toISOString(),
        revokedAt: null,
        lastUsedAt: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }
      await connect(c.env.DB).insert(tokens).values(row)
      note.target = { type: 'token', id: row.id }
      note.detail = { kind, label, scopes, expiresAt: row.expiresAt }
      return json({ id: row.id, kind, label, scopes, expiresAt: row.expiresAt, secret }, 201)
    }),
  )

  app.post(
    '/v1/admin/tokens/:id/revoke',
    admin('token.revoke', async (c, person, note) => {
      const now = options.clock.now().toISOString()
      const db = connect(c.env.DB)
      const id = c.req.param('id') ?? ''
      note.target = { type: 'token', id }
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
    admin(null, async (c, person) => {
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

  /** What a change of a member answers, by what it did. */
  const answerOf = (change: PeopleChange): Response => {
    switch (change) {
      case 'changed':
      case 'unchanged':
        return json({ outcome: change })
      case 'not_member':
        return refused(
          'That person is no member of this site.',
          'Pick someone from the list of people.',
          404,
        )
      case 'last_owner':
        return refused(
          'A site keeps at least one owner, and this is its last one.',
          'Make another person an owner first, then change this one.',
          409,
        )
    }
  }

  // Another role for a member of the site of the token: owner, editor or author.
  app.post(
    '/v1/admin/people/role',
    admin('member.role', async (c, person, note) => {
      const input = await body(c)
      const role = input['role']
      const userId = input['userId']
      if (typeof userId !== 'string' || typeof role !== 'string' || !isRole(role)) {
        return refused(
          'Give the userId of a member and a role.',
          `Send { "userId": "usr_…", "role": "owner" | "editor" | "author" }.`,
        )
      }
      const now = options.clock.now().toISOString()
      note.target = { type: 'user', id: userId }
      note.detail = { role }
      return answerOf(await setRole(c.env.DB, { site: person.site, userId, role, now }))
    }),
  )

  // A member out of the site of the token, with every token and grant they had of it.
  app.post(
    '/v1/admin/people/remove',
    admin('member.remove', async (c, person, note) => {
      const userId = (await body(c))['userId']
      if (typeof userId !== 'string') {
        return refused('Give the userId of a member.', 'Send { "userId": "usr_…" }.')
      }
      note.target = { type: 'user', id: userId }
      return answerOf(await removeMember(c.env.DB, { site: person.site, userId }))
    }),
  )

  app.post(
    '/v1/admin/invitations',
    admin('invitation.create', async (c, person, note) => {
      const input = await body(c)
      const role = input['role']
      // An owner is made by `hollware init`; the admin invites editors and authors.
      if (typeof role !== 'string' || !isRole(role) || role === 'owner') {
        return refused(
          'An invitation is for an editor or an author.',
          `Use role "editor" (${ROLE_SCOPES.editor.join(', ')}) or "author" (${ROLE_SCOPES.author.join(', ')}).`,
        )
      }
      const days = invitationDays(input['days'], INVITATION_DAYS)
      if (days === null)
        return refused('days is a whole number from 1 to 365.', 'Leave it out for 7 days.')
      const made = await createInvitation(connect(c.env.DB), {
        site: person.site,
        role,
        userId: null,
        now: options.clock.now(),
        days,
      })
      note.target = { type: 'invitation', id: made.id }
      note.detail = { role, days }
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

  // ---- the activity log of the site (ADR-037): for whoever holds schema:admin, its owners --------

  const filtersOf = (c: Context<GatewayEnv>): ActivityFilters => {
    const filters: Record<string, string> = {}
    for (const name of ['actor', 'action', 'targetType', 'targetId', 'from', 'to'] as const) {
      const value = c.req.query(name)
      if (value !== undefined && value !== '') filters[name] = value
    }
    return filters
  }
  /** An answer of the log, or the refusal of a filter or a cursor that is not valid. */
  const reading = async (read: () => Promise<Response>): Promise<Response> => {
    try {
      return await read()
    } catch (error) {
      if (error instanceof ActivityInputError) return refused(error.message, error.fix)
      throw error
    }
  }

  app.get(
    '/v1/admin/activity',
    admin(null, async (c, person) =>
      reading(async () => {
        const cursor = c.req.query('cursor')
        const limit = Number(c.req.query('limit') ?? ACTIVITY_PAGE)
        return json(
          await readActivity(c.env.DB, person.site, filtersOf(c), {
            ...(cursor === undefined ? {} : { cursor }),
            limit: Number.isFinite(limit) ? limit : ACTIVITY_PAGE,
          }),
        )
      }),
    ),
  )

  // The same lines as CSV, newest first, up to ACTIVITY_CSV_MAX of them.
  app.get(
    '/v1/admin/activity.csv',
    admin(null, async (c, person) =>
      reading(async () => {
        const rows: string[] = [ACTIVITY_CSV_COLUMNS.join(',')]
        let cursor: string | undefined
        do {
          const page = await readActivity(c.env.DB, person.site, filtersOf(c), {
            ...(cursor === undefined ? {} : { cursor }),
            limit: 500,
          })
          rows.push(...page.lines.map(activityCsvRow))
          cursor = page.nextCursor ?? undefined
        } while (cursor !== undefined && rows.length <= ACTIVITY_CSV_MAX)
        return new Response(`${rows.join('\r\n')}\r\n`, {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="activity-${person.site}.csv"`,
            'cache-control': 'no-store',
          },
        })
      }),
    ),
  )

  // ---- the person's own sign-in, for every role (T-44, T-45, T-54) ----------------------------

  /** The OAuth helpers and the admin's own client, for the public URL of the request. */
  const grantsApi = async (c: Context<GatewayEnv>) => {
    const oauth = options.oauth(c.env.HOLLWARE_PUBLIC_URL)
    return {
      helpers: oauth.authorizationServer.getOAuthApi(c.env),
      admin: (await adminClient(oauth, c.env)).clientId,
    }
  }

  // The person's passkeys, without their keys or credential ids, and the apps they connected: each
  // grant, with the name of its client, its scopes, its site and when. The grants of the admin are
  // marked: they end by signing out, not here.
  app.get(
    '/v1/admin/account',
    admin(
      null,
      async (c, person) => {
        const passkeys = await passkeySummaries(connect(c.env.DB), person.userId)
        const { helpers, admin: ours } = await grantsApi(c)
        const grants = await grantsOf(helpers, person.userId)
        const names = new Map<string, Promise<string>>()
        const nameOf = (clientId: string) => {
          const known = names.get(clientId)
          if (known !== undefined) return known
          const asked = clientName(helpers, clientId)
          names.set(clientId, asked)
          return asked
        }
        const apps = await Promise.all(
          grants.map(async (grant) => ({
            grantId: grant.id,
            clientId: grant.clientId,
            name: await nameOf(grant.clientId),
            scopes: grant.scope.filter(isScope),
            site: siteOf(grant.metadata),
            createdAt: new Date(grant.createdAt * 1000).toISOString(),
            admin: grant.clientId === ours,
          })),
        )
        apps.sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt) || a.grantId.localeCompare(b.grantId),
        )
        return json({ passkeys, apps })
      },
      { anyone: true },
    ),
  )

  // One of the person's passkeys out, never their last one: that one is refused, not removed.
  app.post(
    '/v1/admin/account/passkeys/remove',
    admin(
      'passkey.remove',
      async (c, person, note) => {
        const id = (await body(c))['id']
        if (typeof id !== 'string') {
          return refused('Give the id of one of your passkeys.', 'Send { "id": "pky_…" }.')
        }
        note.target = { type: 'passkey', id }
        switch (await removePasskey(c.env.DB, { userId: person.userId, id })) {
          case 'removed':
            return json({ outcome: 'removed', id })
          case 'not_found':
            return refused(
              'You have no such passkey.',
              'List your passkeys and pick one of them.',
              404,
            )
          case 'last':
            return refused(
              'This is your last passkey: without it you could not sign in again.',
              'Add another passkey first, then remove this one.',
              409,
            )
        }
      },
      { anyone: true, everySite: true },
    ),
  )

  // An app the person connected loses its grant, and with it every token it holds. Only the
  // person's own grants, and never the admin's: the admin ends by signing out.
  app.post(
    '/v1/admin/account/apps/revoke',
    admin(
      'app.revoke',
      async (c, person, note) => {
        const grantId = (await body(c))['grantId']
        if (typeof grantId !== 'string') {
          return refused('Give the grantId of one of your apps.', 'Send { "grantId": "…" }.')
        }
        note.target = { type: 'grant', id: grantId }
        const { helpers, admin: ours } = await grantsApi(c)
        const grant = (await grantsOf(helpers, person.userId)).find((g) => g.id === grantId)
        if (grant === undefined) {
          return refused('You connected no such app.', 'List your apps and pick one of them.', 404)
        }
        if (grant.clientId === ours) {
          return refused(
            'That is this admin: it is not revoked here.',
            'Sign out from the person menu, or sign out everywhere.',
            409,
          )
        }
        await helpers.revokeGrant(grant.id, person.userId)
        note.detail = { clientId: grant.clientId, site: siteOf(grant.metadata) }
        return json({ outcome: 'revoked', grantId: grant.id })
      },
      { anyone: true, everySite: true },
    ),
  )

  // Every session of the person ends, and every grant of the admin with it: each browser, this one
  // included, signs in with a passkey again. The apps they connected keep their grants.
  app.post(
    '/v1/admin/account/sessions/end',
    admin(
      'session.end_all',
      async (c, person, note) => {
        const ended = await endSessions(connect(c.env.DB), person.userId)
        const { helpers, admin: ours } = await grantsApi(c)
        const admins = (await grantsOf(helpers, person.userId)).filter((g) => g.clientId === ours)
        for (const grant of admins) await helpers.revokeGrant(grant.id, person.userId)
        note.target = { type: 'user', id: person.userId }
        note.detail = { sessions: ended, adminGrants: admins.length }
        return json({ outcome: 'ended', sessions: ended, adminGrants: admins.length })
      },
      { anyone: true, everySite: true },
    ),
  )
}
