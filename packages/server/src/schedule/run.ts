import { systemActor, type AuditActor, type AuditLog } from '../audit/log.ts'
import type { ResolvedSite, Scope } from '@hollware/core'
import type { Handlers } from '../ops/types.ts'
import type { Principal } from '../auth/types.ts'
import type { Actor, Clock, ContentStore } from '../ports.ts'

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

export async function runDueSchedules(input: {
  readonly site: ResolvedSite
  readonly store: ContentStore
  readonly handlers: Handlers
  readonly clock: Clock
  readonly log: (entry: object) => void
  readonly scopesOf: (actor: Actor) => Promise<readonly Scope[]>
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

export async function runDueUnpublishes(input: {
  readonly site: ResolvedSite
  readonly store: ContentStore
  readonly handlers: Handlers
  readonly clock: Clock
  readonly log: (entry: object) => void
  readonly scopesOf: (actor: Actor) => Promise<readonly Scope[]>
  readonly audit?: (actor: AuditActor, requestId: string) => AuditLog
}): Promise<ScheduleRun> {
  const { site, store, handlers, clock, log } = input
  const due = await store.dueUnpublishes(site.key, clock.now().toISOString())
  let published = 0
  let cancelled = 0
  for (const unpublication of due) {
    const requestId = `cron_${crypto.randomUUID()}`
    const scopes = await input.scopesOf(unpublication.actor)
    const allowed = scopes.includes('content:publish')
    if (allowed) {
      await handlers.unpublish(
        { id: unpublication.entryId },
        {
          site,
          principal: principalOf(unpublication.actor, site.key, scopes),
          view: 'head',
          store,
          clock,
          client: unpublication.actor.meta,
          requestId,
        },
      )
      published += 1
    } else {
      cancelled += 1
    }
    await store.cancelUnpublish(site.key, unpublication.entryId)
    await input.audit?.(systemActor(unpublication.actor.userId), requestId).write(site, {
      action: 'schedule.unpublish',
      outcome: allowed ? 'ok' : 'denied',
      errorCode: allowed ? null : 'insufficient_scope',
      target: { type: 'entry', id: unpublication.entryId },
      detail: {
        unpublishAt: unpublication.unpublishAt,
        scheduledBy: { kind: unpublication.actor.kind, tokenId: unpublication.actor.tokenId },
      },
    })
    log({
      kind: 'unpublish_schedule',
      requestId,
      entryId: unpublication.entryId,
      unpublishAt: unpublication.unpublishAt,
      outcome: allowed ? 'unpublished' : 'insufficient_scope',
    })
  }
  return { published, cancelled }
}
