import type { ResolvedSite, Scope } from '@hollware/core'
import type { Handlers } from '../ops/types.ts'
import type { Clock, ContentStore } from '../ports.ts'

/** What the publication of a schedule may do: what `publish` needs, in the scheduler's name. */
const SCHEDULER_SCOPES: readonly Scope[] = ['content:read', 'content:write', 'content:publish']

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
}): Promise<ScheduleRun> {
  const { site, store, handlers, clock, log } = input
  const due = await store.dueSchedules(site.key, clock.now().toISOString())
  let published = 0
  let cancelled = 0
  for (const schedule of due) {
    const requestId = `cron_${crypto.randomUUID()}`
    const answer = await handlers.publish(
      {
        id: schedule.entryId,
        version: schedule.version,
        acknowledgeWarnings: [...schedule.acknowledged],
        group: [],
      },
      {
        site,
        principal: {
          kind: 'token',
          userId: schedule.actor.userId,
          tokenId: schedule.actor.tokenId ?? '',
          site: site.key,
          scopes: SCHEDULER_SCOPES,
        },
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
