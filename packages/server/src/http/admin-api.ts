import {
  canSignPreviews,
  generatePersonalToken,
  generateReadToken,
  HollwareError,
  hashPersonalToken,
  isId,
  isScope,
  makePreviewToken,
  newId,
  parseHollwareEvent,
  PERSONAL_TOKEN_TTL_DAYS,
  PREVIEW_QUERY_PARAM,
  emailAddress,
  type ResolvedAuth,
  type ResolvedSite,
  type Scope,
} from '@hollware/core'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import type { Context, Hono } from 'hono'
import { insufficientScope } from '../auth/index.ts'
import { isRole, ROLE_SCOPES } from '../auth/roles.ts'
import { anonymizePerson, formerPeople } from '../identity/anonymize.ts'
import { removeMember, setRole, type PeopleChange } from '../identity/people.ts'
import type { Principal, RequestPrincipal } from '../auth/types.ts'
import type { AuditAction } from '@hollware/core'
import type { AuditLine } from '../audit/log.ts'
import type { AuditLogFor } from '../mcp/index.ts'
import { connect } from '../db/d1.ts'
import { failedDeliveries, sendAgain, type FailedDelivery } from '../db/events.ts'
import { purgeEntry } from '../db/purge.ts'
import { enqueue } from '../events/run.ts'
import { createD1Store } from '../db/index.ts'
import { invitations, members, tokens, users } from '../db/schema.ts'
import {
  cleanName,
  createInvitation,
  endSessions,
  identitiesOf,
  MAX_NAME_LENGTH,
  membershipsOf,
  passkeySummaries,
  removePasskey,
  renamePasskey,
  revokeInvitation,
  renameUser,
} from '../identity/store.ts'
import { withoutTrailingSlashes } from '../analytics/normalize.ts'
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

const INVITATION_DAYS = 7
const ACTIVITY_PAGE = 50
const DELIVERIES_PAGE = 50
const ACTIVITY_CSV_MAX = 10_000

export interface AdminApiOptions {
  readonly auth?: ResolvedAuth
  readonly sites: ReadonlySet<string>
  readonly site: (key: string) => ResolvedSite | undefined
  readonly audit: (c: Context<GatewayEnv>, principal: RequestPrincipal) => Promise<AuditLogFor>
  readonly clock: Clock
  readonly oauth: (publicUrl: string) => OAuth
  readonly protect: (c: Context<GatewayEnv>, proceed: Proceed) => Promise<Response>
  readonly metadataUrl: (c: Context<GatewayEnv>) => string
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

const REFUSAL_CODES = {
  400: 'invalid_input',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
} as const

function refusalCode(status: number): string {
  if (status === 503) return 'unavailable'
  return status === 403 || status === 404 || status === 409 ? REFUSAL_CODES[status] : 'internal'
}

function pageUrlOf(
  site: ResolvedSite,
  entry: { readonly collection: string; readonly locale: string; readonly slug: string },
): string | null {
  const route = site.collections.get(entry.collection)?.routes[entry.locale]
  if (site.url === null || route === undefined) return null
  return `${withoutTrailingSlashes(site.url)}${route.replace(/:slug(?![A-Za-z0-9_])/, entry.slug)}`
}

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

function invitationDays(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365
    ? value
    : null
}

function daysFrom(value: unknown, fallback: number | null): number | null | undefined {
  if (value === undefined) return fallback
  if (value === null) return null
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365
    ? value
    : undefined
}

const GRANT_PAGES = 10

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

async function clientName(helpers: OAuthHelpers, clientId: string): Promise<string> {
  try {
    return (await helpers.lookupClient(clientId))?.clientName ?? clientId
  } catch {
    return clientId
  }
}

function deliveryView(row: FailedDelivery) {
  const event = parseHollwareEvent(row.payload)
  return {
    event: row.event,
    kind: row.kind,
    entry:
      event !== null && 'entry' in event
        ? { collection: event.entry.collection, locale: event.entry.locale, slug: event.entry.slug }
        : null,
    subscriber: row.subscriber,
    attempts: row.attempts,
    lastError: row.lastError,
    triedAt: row.triedAt,
    abandonedAt: row.abandonedAt,
  }
}

function siteOf(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const site: unknown = Reflect.get(metadata, 'site')
  return typeof site === 'string' ? site : null
}

export function installAdminApi(app: Hono<GatewayEnv>, options: AdminApiOptions): void {
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

  app.post(
    '/v1/admin/preview',
    admin(
      'preview.create',
      async (c, person, note) => {
        const entryId = (await body(c))['entryId']
        if (typeof entryId !== 'string' || !isId('ent', entryId)) {
          return refused('Give the id of an entry.', 'Send { "entryId": "ent_…" }.')
        }
        note.target = { type: 'entry', id: entryId }
        const secret = c.env.HOLLWARE_SECRET
        if (!canSignPreviews(secret)) {
          return json(
            {
              code: 'unavailable',
              message: 'This Hollware cannot make preview links: it has no signing secret.',
              fix: 'Set the Worker secret HOLLWARE_SECRET to at least 32 characters (`hollware deploy` makes one), then try again.',
            },
            503,
          )
        }
        const site = options.site(person.site)
        const found = await createD1Store(c.env.DB).findEntryById(person.site, entryId, 'head')
        if (site === undefined || found === null) {
          return refused(
            'This site has no such entry.',
            'Open the entry from its collection in the admin.',
            404,
          )
        }
        const made = await makePreviewToken({
          secret,
          site: person.site,
          entryId,
          now: options.clock.now(),
        })
        const page = pageUrlOf(site, found.entry)
        note.detail = { expiresAt: made.expiresAt }
        return json({
          token: made.token,
          expiresAt: made.expiresAt,
          url: page === null ? null : `${page}?${PREVIEW_QUERY_PARAM}=${made.token}`,
        })
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
      const asked =
        kind === 'read'
          ? ['content:read']
          : Array.isArray(input['scopes'])
            ? input['scopes'].filter((s) => typeof s === 'string')
            : []
      const scopes = person.scopes.filter((scope) => asked.includes(scope))
      if (scopes.length === 0) {
        return refused(
          'A token needs at least one scope that you have.',
          `Choose among ${person.scopes.join(', ')}.`,
        )
      }
      const days = daysFrom(
        input['expiresInDays'],
        kind === 'personal' ? PERSONAL_TOKEN_TTL_DAYS : null,
      )
      if (days === undefined)
        return refused(
          'expiresInDays is a whole number from 1 to 365, or null.',
          `Leave it out for ${PERSONAL_TOKEN_TTL_DAYS} days (a read token: never), or send null for a token that never expires.`,
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
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: members.role,
          since: members.createdAt,
        })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(eq(members.siteId, person.site))
        .orderBy(members.createdAt, users.id)
      const pending = await db
        .select({
          id: invitations.id,
          role: invitations.role,
          email: invitations.email,
          expiresAt: invitations.expiresAt,
        })
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
      return json({
        people,
        invitations: pending,
        former: await formerPeople(c.env.DB, person.site),
      })
    }),
  )

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
    '/v1/admin/people/anonymize',
    admin('member.anonymize', async (c, person) => {
      const userId = (await body(c))['userId']
      if (typeof userId !== 'string') {
        return refused('Give the userId of a former member.', 'Send { "userId": "usr_…" }.')
      }
      const outcome = await anonymizePerson(c.env.DB, {
        site: person.site,
        userId,
        now: options.clock.now().toISOString(),
      })
      if (outcome === 'member') {
        return refused(
          'That person is still a member of this site.',
          'Remove them from the site first, then anonymize them.',
          409,
        )
      }
      if (outcome === 'not_found') {
        return refused(
          'No former member of this site has that id.',
          'Pick someone from the former members of the site.',
          404,
        )
      }
      const { helpers } = await grantsApi(c)
      for (const grant of await grantsOf(helpers, userId)) {
        if (outcome === 'gone' || siteOf(grant.metadata) === person.site) {
          await helpers.revokeGrant(grant.id, userId)
        }
      }
      return json({ outcome })
    }),
  )

  app.post(
    '/v1/admin/invitations',
    admin('invitation.create', async (c, person, note) => {
      const input = await body(c)
      const role = input['role']
      if (typeof role !== 'string' || !isRole(role) || role === 'owner') {
        return refused(
          'An invitation is for an editor or an author.',
          `Use role "editor" (${ROLE_SCOPES.editor.join(', ')}) or "author" (${ROLE_SCOPES.author.join(', ')}).`,
        )
      }
      const days = invitationDays(input['days'], INVITATION_DAYS)
      if (days === null)
        return refused('days is a whole number from 1 to 365.', 'Leave it out for 7 days.')
      const asked = input['email']
      const blank = asked === undefined || asked === null || asked === ''
      const email = !blank && typeof asked === 'string' ? emailAddress(asked) : null
      if (!blank && email === null) {
        return refused(
          'email is not an email address.',
          'Send the address the person signs in with, such as "ada@example.com", or leave it out.',
        )
      }
      const made = await createInvitation(connect(c.env.DB), {
        site: person.site,
        role,
        userId: null,
        now: options.clock.now(),
        days,
        email,
      })
      note.target = { type: 'invitation', id: made.id }
      note.detail = email === null ? { role, days } : { role, days, email: true }
      const origin = options.oauth(c.env.HOLLWARE_PUBLIC_URL).issuer
      return json(
        {
          id: made.id,
          role,
          email,
          expiresAt: made.expiresAt,
          link: `${origin}/setup#invitation=${made.secret}`,
        },
        201,
      )
    }),
  )

  app.post(
    '/v1/admin/invitations/:id/revoke',
    admin('invitation.revoke', async (c, person, note) => {
      const id = c.req.param('id') ?? ''
      note.target = { type: 'invitation', id }
      const revoked = await revokeInvitation(connect(c.env.DB), {
        site: person.site,
        id,
        now: options.clock.now(),
      })
      return revoked
        ? json({ outcome: 'revoked' })
        : refused(
            'There is no waiting invitation with that id.',
            'List the people of the site and pick an invitation that waits.',
            404,
          )
    }),
  )

  app.post(
    '/v1/admin/entries/:id/purge',
    admin('entry.purge', async (c, person, note) => {
      const id = c.req.param('id') ?? ''
      note.target = { type: 'entry', id }
      const outcome = await purgeEntry(c.env.DB, {
        site: person.site,
        entryId: id,
        purgedBy: person.userId,
        now: options.clock.now().toISOString(),
      })
      if (outcome === 'not_found') {
        return refused('This site has no entry with that id.', 'Pick an entry of its trash.', 404)
      }
      if (outcome === 'not_in_trash') {
        return refused(
          'Only an entry in the trash is deleted for ever.',
          'Move it to the trash first; a published one is unpublished before.',
          409,
        )
      }
      return json({ outcome: 'purged' })
    }),
  )

  app.get(
    '/v1/admin/database',
    admin(null, async (c) => {
      const { meta } = await c.env.DB.prepare('SELECT 1').run()
      return json({ bytes: meta.size_after })
    }),
  )

  app.get(
    '/v1/admin/deliveries',
    admin(null, async (c, person) => {
      const rows = await failedDeliveries(connect(c.env.DB), person.site, DELIVERIES_PAGE)
      return json({ deliveries: rows.map(deliveryView) })
    }),
  )

  app.post(
    '/v1/admin/events/:id/retry',
    admin('event.retry', async (c, person, note) => {
      const id = c.req.param('id') ?? ''
      note.target = { type: 'event', id }
      const db = connect(c.env.DB)
      if (!(await sendAgain(db, person.site, id, options.clock.now().toISOString()))) {
        return refused(
          'This site has no event with a delivery that failed under that id.',
          'List the deliveries that failed, under Webhooks, and send one of their events.',
          404,
        )
      }
      await enqueue({ queue: c.env.EVENTS, db, site: person.site, ids: [id], clock: options.clock })
      return json({ outcome: 'queued' })
    }),
  )

  const filtersOf = (c: Context<GatewayEnv>): ActivityFilters => {
    const filters: Record<string, string> = {}
    for (const name of ['actor', 'action', 'targetType', 'targetId', 'from', 'to'] as const) {
      const value = c.req.query(name)
      if (value !== undefined && value !== '') filters[name] = value
    }
    return filters
  }
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

  const grantsApi = async (c: Context<GatewayEnv>) => {
    const oauth = options.oauth(c.env.HOLLWARE_PUBLIC_URL)
    return {
      helpers: oauth.authorizationServer.getOAuthApi(c.env),
      admin: (await adminClient(oauth, c.env)).clientId,
    }
  }

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
        const providers = options.auth?.providers ?? []
        const identities = (await identitiesOf(connect(c.env.DB), person.userId)).map(
          (identity) => ({
            ...identity,
            name: providers.find((p) => p.id === identity.provider)?.name ?? identity.provider,
          }),
        )
        return json({
          passkeys,
          apps,
          identities,
          passkeysEnabled: options.auth?.passkeys ?? true,
        })
      },
      { anyone: true },
    ),
  )

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
              'Add another passkey, or sign in once with an account of a provider, then remove this one.',
              409,
            )
        }
      },
      { anyone: true, everySite: true },
    ),
  )

  const enrolling = (c: Context<GatewayEnv>) => ({
    db: connect(c.env.DB),
    publicUrl: c.env.HOLLWARE_PUBLIC_URL,
    now: options.clock.now(),
  })
  const passkeysOff = () =>
    refused(
      'This Hollware does not sign people in with passkeys.',
      'Sign in with your account of a provider.',
      403,
    )

  app.post(
    '/v1/admin/account/passkeys/options',
    admin(
      null,
      async (c, person) => {
        if (options.auth?.passkeys === false) return passkeysOff()
        const { enrollmentOptions } = await import('../identity/ceremonies.ts')
        return json(await enrollmentOptions(enrolling(c), person.userId))
      },
      { anyone: true },
    ),
  )

  app.post(
    '/v1/admin/account/passkeys/verify',
    admin(
      'passkey.add',
      async (c, person, note) => {
        if (options.auth?.passkeys === false) return passkeysOff()
        const input = await body(c)
        const response = input['response']
        if (typeof response !== 'object' || response === null || Array.isArray(response)) {
          return refused('The body has no passkey.', 'Send the credential as JSON.')
        }
        const { verifyEnrollment } = await import('../identity/ceremonies.ts')
        try {
          const added = await verifyEnrollment(enrolling(c), person.userId, {
            challengeId: typeof input['challengeId'] === 'string' ? input['challengeId'] : '',
            response: JSON.parse(JSON.stringify(response)),
            label: typeof input['label'] === 'string' ? input['label'] : '',
          })
          note.target = { type: 'passkey', id: added.id }
          return json({ outcome: 'added', id: added.id }, 201)
        } catch (error) {
          if (error instanceof HollwareError) return refused(error.message, error.fix)
          throw error
        }
      },
      { anyone: true, everySite: true },
    ),
  )

  app.post(
    '/v1/admin/account/passkeys/rename',
    admin(
      'passkey.rename',
      async (c, person, note) => {
        const sent = await body(c)
        const id = sent['id']
        const label = cleanName(sent['label'])
        if (typeof id !== 'string' || label === null) {
          return refused(
            `Give the id of one of your passkeys, and a label of 1 to ${MAX_NAME_LENGTH} characters.`,
            'Send { "id": "pky_…", "label": "Phone" }.',
          )
        }
        note.target = { type: 'passkey', id }
        if (!(await renamePasskey(connect(c.env.DB), { userId: person.userId, id, label }))) {
          return refused(
            'You have no such passkey.',
            'List your passkeys and pick one of them.',
            404,
          )
        }
        return json({ outcome: 'renamed', id, label })
      },
      { anyone: true, everySite: true },
    ),
  )

  app.post(
    '/v1/admin/account/name',
    admin(
      'account.rename',
      async (c, person, note) => {
        const name = cleanName((await body(c))['name'])
        if (name === null) {
          return refused(
            `Give a name of 1 to ${MAX_NAME_LENGTH} characters.`,
            'Send { "name": "Ada Lovelace" }.',
          )
        }
        note.target = { type: 'user', id: person.userId }
        await renameUser(connect(c.env.DB), person.userId, name)
        return json({ outcome: 'renamed', name })
      },
      { anyone: true, everySite: true },
    ),
  )

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
