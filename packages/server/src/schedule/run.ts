import { systemActor, type AuditActor, type AuditLog } from '../audit/log.ts'
import type { ResolvedSite, Scope } from '@hollware/core'
import type { Handlers } from '../ops/types.ts'
import type { Principal } from '../auth/types.ts'
import type { Actor, Clock, ContentStore } from '../ports.ts'

/**
 * The principal a schedule publishes as: the token, or the OAuth client, that scheduled it, with
 * the scopes it holds now (`scopesNow`). An OAuth client is known by the id its actor kept
 * (ADR-026).
 */
function principalOf(actor: Actor, site: string, scopes: readonly Scope[]): Principal {
  if (actor.kind === 'oauth_client') {
    const client = actor.meta?.['oauthClient']
    return {
      kind: 'oauth',
      userId: actor.userId,
      clientId: typeof client === 'string' ? client : 'unknown',
      site,
      scopes,
    }
  }
  if (actor.tokenId === null) {
    throw new Error(`A schedule of a ${actor.kind} has no token to publish with`)
  }
  return {
    kind: 'token',
    userId: actor.userId,
    tokenId: actor.tokenId,
    site,
    scopes,
  }
}

export interface ScheduleRun {
  readonly published: number
  readonly cancelled: number
}

/**
 * Publishes the scheduled entries whose time has come (ADR-025), one by one, through the same
 * handler as `publish`, in the name of who scheduled each one and with the warnings acknowledged
 * then. An entry that cannot be published (it changed after it was scheduled, or the contracts now
 * block it or warn about something new) goes back to a draft, and the log says why. A failure of
 * the database leaves the schedule for the next run.
 */
export async function runDueSchedules(input: {
  readonly site: ResolvedSite
  readonly store: ContentStore
  readonly handlers: Handlers
  readonly clock: Clock
  readonly log: (entry: object) => void
  /**
   * What who scheduled an entry may do now: a revoked token, a revoked grant, a member removed or
   * a role that no longer publishes cancels the publication instead (T-108).
   */
  readonly scopesOf: (actor: Actor) => Promise<readonly Scope[]>
  /**
   * The activity log (ADR-037), for the deployment acting for the person who scheduled each
   * entry; without it, no line is written.
   */
  readonly audit?: (actor: AuditActor, requestId: string) => AuditLog
}): Promise<ScheduleRun> {
  const { site, store, handlers, clock, log } = input
  const due = await store.dueSchedules(site.key, clock.now().toISOString())
  let published = 0
  let cancelled = 0
  for (const schedule of due) {
    const requestId = `cron_${crypto.randomUUID()}`
    const scopes = await input.scopesOf(schedule.actor)
    if (!scopes.includes('content:publish')) {
      await store.cancelSchedule(site.key, schedule.entryId)
      cancelled += 1
      await input.audit?.(systemActor(schedule.actor.userId), requestId).write(site, {
        action: 'schedule.publish',
        outcome: 'denied',
        errorCode: 'insufficient_scope',
        target: { type: 'entry', id: schedule.entryId },
        detail: {
          scheduledAt: schedule.scheduledAt,
          scheduledBy: { kind: schedule.actor.kind, tokenId: schedule.actor.tokenId },
        },
      })
      log({
        kind: 'schedule',
        requestId,
        entryId: schedule.entryId,
        scheduledAt: schedule.scheduledAt,
        outcome: 'insufficient_scope',
      })
      continue
    }
    const answer = await handlers.publish(
      {
        id: schedule.entryId,
        version: schedule.version,
        acknowledgeWarnings: [...schedule.acknowledged],
        group: [],
      },
      {
        site,
        principal: principalOf(schedule.actor, site.key, scopes),
        view: 'head',
        store,
        clock,
        client: schedule.actor.meta,
        requestId,
      },
    )
    if (answer.outcome === 'published') {
      published += 1
    } else {
      await store.cancelSchedule(site.key, schedule.entryId)
      cancelled += 1
    }
    await input.audit?.(systemActor(schedule.actor.userId), requestId).write(site, {
      action: 'schedule.publish',
      outcome: answer.outcome === 'published' ? 'ok' : 'failed',
      errorCode: answer.outcome === 'published' ? null : answer.outcome,
      target: { type: 'entry', id: schedule.entryId },
      detail: {
        scheduledAt: schedule.scheduledAt,
        scheduledBy: { kind: schedule.actor.kind, tokenId: schedule.actor.tokenId },
      },
    })
    log({
      kind: 'schedule',
      requestId,
      entryId: schedule.entryId,
      scheduledAt: schedule.scheduledAt,
      outcome: answer.outcome,
    })
  }
  return { published, cancelled }
}
