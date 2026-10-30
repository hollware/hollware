import { defineCollection, defineComponent, defineConfig } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import * as z from 'zod'

import { backupKey } from '../../src/backup/run.ts'
import { handlers } from '../../src/ops/index.ts'
import { seedSite, type SeededSite } from '../support/sites.ts'
import { boot, captureLogs, NOW, restoreLogs, SITE_KEY } from './support.ts'

afterEach(() => {
  restoreLogs()
})

const PAST = '2000-01-01T00:00:00.000Z'
const FUTURE = '2099-01-01T00:00:00.000Z'

describe('the cron trigger and what of sign-in expired', () => {
  it('drops the challenges, sessions and agent grants that expired, the revoked grants, and keeps the others', async () => {
    const worker = boot()
    const db = worker.env.DB
    const user = `usr_${crypto.randomUUID().replaceAll('-', '').slice(0, 26).toUpperCase()}`
    await db
      .prepare(
        "INSERT INTO users (id, name, role, created_at, updated_at) VALUES (?1, 'Cron', 'editor', ?2, ?2)",
      )
      .bind(user, PAST)
      .run()
    const tag = crypto.randomUUID().slice(0, 8)
    const challenge = (id: string, expires: string) =>
      db
        .prepare(
          "INSERT INTO auth_challenges (id, challenge, purpose, expires_at, created_at, updated_at) VALUES (?1, 'c', 'authenticate', ?2, ?3, ?3)",
        )
        .bind(id, expires, PAST)
    const session = (id: string, expires: string) =>
      db
        .prepare(
          'INSERT INTO sessions (id, user_id, hash, expires_at, created_at, updated_at) VALUES (?1, ?2, ?1, ?3, ?4, ?4)',
        )
        .bind(id, user, expires, PAST)
    const grant = (id: string, expires: string, revoked: string | null) =>
      db
        .prepare(
          "INSERT INTO agent_grants (id, site_id, user_id, agent, hash, scopes, expires_at, revoked_at, created_at, updated_at) VALUES (?1, ?2, ?3, 'reviewer', ?1, '[]', ?4, ?5, ?6, ?6)",
        )
        .bind(id, `cron-grants-${tag}`, user, expires, revoked, PAST)
    await db.batch([
      db
        .prepare('INSERT INTO sites (id, created_at, updated_at) VALUES (?1, ?2, ?2)')
        .bind(`cron-grants-${tag}`, PAST),
      grant(`agt_old_${tag}`, NOW, null),
      grant(`agt_revoked_${tag}`, FUTURE, PAST),
      grant(`agt_new_${tag}`, '2026-10-13T12:00:00.001Z', null),
      challenge(`chl_old_${tag}`, PAST),
      challenge(`chl_new_${tag}`, FUTURE),
      session(`ses_old_${tag}`, PAST),
      session(`ses_new_${tag}`, FUTURE),
    ])

    await worker.worker.scheduled(
      {
        scheduledTime: Date.parse('2026-10-16T12:01:00Z'),
        cron: '* * * * *',
        noRetry: () => undefined,
      },
      worker.env,
      worker.ctx,
    )
    await worker.settle()

    const left = async (table: string) =>
      (
        await db
          .prepare(`SELECT id FROM ${table} WHERE id LIKE ?1 ORDER BY id`)
          .bind(`%_${tag}`)
          .all<{ id: string }>()
      ).results.map((row) => row.id)
    expect(await left('auth_challenges')).toEqual([`chl_new_${tag}`])
    expect(await left('sessions')).toEqual([`ses_new_${tag}`])
    expect(await left('agent_grants')).toEqual([`agt_new_${tag}`])
  })

  it('rebuilds a revision an older pipeline parsed', async () => {
    const worker = boot()
    const db = worker.env.DB
    const seeded = await seedSite(db, SITE_KEY)
    await worker.send('/health')
    const entry = seeded.entries[0]?.id ?? ''
    await db
      .prepare("UPDATE revisions SET pipeline_version = '1', document = '{}' WHERE entry_id = ?1")
      .bind(entry)
      .run()

    await worker.worker.scheduled(
      {
        scheduledTime: Date.parse('2026-10-16T12:01:00Z'),
        cron: '* * * * *',
        noRetry: () => undefined,
      },
      worker.env,
      worker.ctx,
    )
    await worker.settle()

    const row = await db
      .prepare('SELECT pipeline_version, document FROM revisions WHERE entry_id = ?1')
      .bind(entry)
      .first<{ pipeline_version: string; document: string }>()
    expect(row?.pipeline_version).toBe('3')
    expect(row?.document).not.toBe('{}')
  })
})

const BLOG = defineCollection({
  schema: z.looseObject({ title: z.string().min(1) }),
  routes: { en: '/en/blog/:slug/', es: '/blog/:slug/' },
  components: {
    callout: defineComponent({
      props: z.strictObject({ type: z.enum(['info', 'warning', 'tip']) }),
      description: 'A highlighted note.',
      example: '::callout{type="tip"}\nKeep it short.\n::',
    }),
  },
})

async function scheduleDraft(db: D1Database, site: SeededSite): Promise<string> {
  const draft = site.entries[2]?.id ?? ''
  await db
    .prepare(
      `INSERT INTO schedules (id, site_id, entry_id, scheduled_at, version, acknowledged,
        actor_kind, actor_user_id, actor_token_id, actor_meta, created_at, updated_at)
        VALUES (?1, ?2, ?3, '2026-10-13T11:00:00.000Z', 1, '[]', 'token', ?4, ?5, NULL, ?6, ?6)`,
    )
    .bind(`sch_${crypto.randomUUID()}`, site.site, draft, site.userId, site.tokenId, PAST)
    .run()
  return draft
}

describe('the cron trigger, site by site', () => {
  it('still publishes the due entry of the next site when the work of one site throws', async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const failing = await seedSite(env.DB, `cron-failing-${tag}`)
    const next = await seedSite(env.DB, `cron-next-${tag}`)
    const worker = boot({
      handlers,
      config: defineConfig({
        sites: {
          [failing.site]: {
            locales: ['en', 'es'],
            defaultLocale: 'en',
            collections: { blog: BLOG },
          },
          [next.site]: { locales: ['en', 'es'], defaultLocale: 'en', collections: { blog: BLOG } },
        },
      }),
    })
    const db = worker.env.DB
    await worker.ready()
    const broken = await scheduleDraft(db, failing)
    await db.prepare("UPDATE entries SET collection = 'retired' WHERE id = ?1").bind(broken).run()
    const due = await scheduleDraft(db, next)
    const logs = captureLogs()

    await worker.worker.scheduled(
      {
        scheduledTime: Date.parse('2026-10-13T12:00:00Z'),
        cron: '* * * * *',
        noRetry: () => undefined,
      },
      worker.env,
      worker.ctx,
    )
    await worker.settle()

    const status = await db
      .prepare('SELECT status FROM entries WHERE id = ?1')
      .bind(due)
      .first<string>('status')
    const lines = logs.entries()
    const failed = lines.findIndex(
      (line) =>
        typeof line === 'object' &&
        line !== null &&
        Reflect.get(line, 'kind') === 'cron_failed' &&
        Reflect.get(line, 'site') === failing.site,
    )
    const published = lines.findIndex(
      (line) =>
        typeof line === 'object' &&
        line !== null &&
        Reflect.get(line, 'kind') === 'schedule' &&
        Reflect.get(line, 'entryId') === due,
    )
    expect(status).toBe('published')
    expect(failed).toBeGreaterThanOrEqual(0)
    expect(published).toBeGreaterThan(failed)
  })
})

describe('the cron trigger, step by step', () => {
  it('queues the event of a scheduled publication in the run that publishes it', async () => {
    const site = await seedSite(env.DB, `cron-order-${crypto.randomUUID().slice(0, 8)}`)
    const sent: unknown[] = []
    const worker = boot({
      handlers,
      config: defineConfig({
        sites: {
          [site.site]: { locales: ['en', 'es'], defaultLocale: 'en', collections: { blog: BLOG } },
        },
      }),
      bindings: {
        EVENTS: {
          sendBatch: async (messages: Iterable<{ readonly body: unknown }>) => {
            for (const message of messages) sent.push(message.body)
          },
        },
      },
    })
    await worker.ready()
    const due = await scheduleDraft(worker.env.DB, site)

    await worker.worker.scheduled(
      {
        scheduledTime: Date.parse('2026-10-13T12:00:00Z'),
        cron: '* * * * *',
        noRetry: () => undefined,
      },
      worker.env,
      worker.ctx,
    )
    await worker.settle()

    const event = await worker.env.DB.prepare(
      "SELECT id, sent_at FROM outbox WHERE site_id = ?1 AND entry_id = ?2 AND kind = 'entry.published'",
    )
      .bind(site.site, due)
      .first<{ id: string; sent_at: string | null }>()
    expect(event?.sent_at).not.toBeNull()
    expect(sent).toEqual([{ site: site.site, id: event?.id }])
  })
})

describe('the daily backup of the cron', () => {
  it('goes to BACKUPS when the Worker binds it, and not to MEDIA', async () => {
    const worker = boot({ bindings: { MEDIA: env.MEDIA, BACKUPS: env.BACKUPS } })
    await worker.ready()
    const key = backupKey(SITE_KEY, NOW.slice(0, 10))
    await Promise.all([env.BACKUPS.delete(key), env.MEDIA.delete(key)])

    await worker.worker.scheduled(
      { scheduledTime: Date.parse(NOW), cron: '* * * * *', noRetry: () => undefined },
      worker.env,
      worker.ctx,
    )
    await worker.settle()

    expect([(await env.BACKUPS.head(key))?.key, await env.MEDIA.head(key)]).toEqual([key, null])
  })
})

describe('the consumer of the events Queue', () => {
  it('gives up on the event of a message from the dead-letter queue, and says so in the activity log', async () => {
    const worker = boot()
    await worker.ready()
    const id = `evt_${crypto.randomUUID().replaceAll('-', '').slice(0, 26).toUpperCase()}`
    await worker.env.DB.prepare(
      "INSERT INTO outbox (id, site_id, kind, entry_id, payload, sent_at, created_at, updated_at) VALUES (?1, ?2, 'site.changed', NULL, '{}', ?3, ?3, ?3)",
    )
      .bind(id, SITE_KEY, NOW)
      .run()
    const abandonedAt = async () =>
      (
        await worker.env.DB.prepare('SELECT abandoned_at FROM outbox WHERE id = ?1')
          .bind(id)
          .first<{ abandoned_at: string | null }>()
      )?.abandoned_at
    const batch = (queue: string) => ({
      queue,
      messages: [{ body: { site: SITE_KEY, id }, ack: () => undefined, retry: () => undefined }],
    })

    await worker.worker.queue(batch('hollware-events'), worker.env, worker.ctx)
    const kept = await abandonedAt()
    await worker.worker.queue(batch('hollware-events-dlq'), worker.env, worker.ctx)

    const lines = await worker.env.DB.prepare(
      'SELECT action, outcome, actor_kind, target_type FROM audit_log WHERE target_id = ?1',
    )
      .bind(id)
      .all()

    expect([kept, await abandonedAt()]).toEqual([null, NOW])
    expect(lines.results).toEqual([
      { action: 'event.abandon', outcome: 'failed', actor_kind: 'system', target_type: 'event' },
    ])
  })

  it('acks a message of a site the deployment does not serve, and throws nothing', async () => {
    const worker = boot()
    const verdicts: string[] = []

    await worker.worker.queue(
      {
        messages: [
          {
            body: { site: 'a-site-nobody-serves', id: 'evt_01JAB3XQ8ZK4M6N2P5R7S9T0VW' },
            ack: () => verdicts.push('ack'),
            retry: () => verdicts.push('retry'),
          },
        ],
      },
      worker.env,
      worker.ctx,
    )

    expect(verdicts).toEqual(['ack'])
  })
})
