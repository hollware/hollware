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
  const groups = new Set<string>()
  for (const schedule of due) {
    if (schedule.group !== null) {
      if (groups.has(schedule.group)) continue
      groups.add(schedule.group)
    }
    const members =
      schedule.group === null ? [schedule] : await store.groupSchedules(site.key, schedule.group)
    const [main = schedule, ...rest] = members
    const requestId = `cron_${crypto.randomUUID()}`
    const scopes = await input.scopesOf(main.actor)
    const audit = async (outcome: 'ok' | 'failed' | 'denied', errorCode: string | null) => {
      for (const member of members) {
        await input.audit?.(systemActor(member.actor.userId), requestId).write(site, {
          action: 'schedule.publish',
          outcome,
          errorCode,
          target: { type: 'entry', id: member.entryId },
          detail: {
            scheduledAt: member.scheduledAt,
            scheduledBy: { kind: member.actor.kind, tokenId: member.actor.tokenId },
          },
        })
      }
    }
    const cancel = async () => {
      for (const member of members) await store.cancelSchedule(site.key, member.entryId)
    }
    if (!scopes.includes('content:publish')) {
      await cancel()
      cancelled += members.length
      await audit('denied', 'insufficient_scope')
      log({
        kind: 'schedule',
        requestId,
        entryId: main.entryId,
        scheduledAt: main.scheduledAt,
        outcome: 'insufficient_scope',
      })
      continue
    }
    const answer = await handlers.publish(
      {
        id: main.entryId,
        version: main.version,
        acknowledgeWarnings: members.flatMap((member) => member.acknowledged),
        group: rest.map((member) => ({ id: member.entryId, version: member.version })),
      },
      {
        site,
        principal: principalOf(main.actor, site.key, scopes),
        view: 'head',
        store,
        clock,
        client: main.actor.meta,
        requestId,
      },
    )
    if (answer.outcome === 'published') {
      published += members.length
    } else {
      await cancel()
      cancelled += members.length
    }
    await audit(
      answer.outcome === 'published' ? 'ok' : 'failed',
      answer.outcome === 'published' ? null : answer.outcome,
    )
    log({
      kind: 'schedule',
      requestId,
      entryId: main.entryId,
      scheduledAt: main.scheduledAt,
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
    const answer = allowed
      ? await handlers.unpublish(
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
      : null
    const outcome = answer === null ? 'insufficient_scope' : answer.outcome
    if (outcome === 'unpublished') published += 1
    else cancelled += 1
    await store.cancelUnpublish(site.key, unpublication.entryId)
    await input.audit?.(systemActor(unpublication.actor.userId), requestId).write(site, {
      action: 'schedule.unpublish',
      outcome: outcome === 'unpublished' ? 'ok' : allowed ? 'failed' : 'denied',
      errorCode: outcome === 'unpublished' ? null : outcome,
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
      outcome,
    })
  }
  return { published, cancelled }
}
