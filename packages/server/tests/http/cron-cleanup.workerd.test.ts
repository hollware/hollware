import { defineCollection, defineComponent, defineConfig } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import * as z from 'zod'

import { handlers } from '../../src/ops/index.ts'
import { seedSite, type SeededSite } from '../support/sites.ts'
import { boot, captureLogs, restoreLogs, SITE_KEY } from './support.ts'

afterEach(() => {
  restoreLogs()
})

const PAST = '2000-01-01T00:00:00.000Z'
const FUTURE = '2099-01-01T00:00:00.000Z'

describe('the cron trigger and what of sign-in expired', () => {
  it('drops the challenges and sessions that expired, and keeps the others', async () => {
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
    await db.batch([
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

describe('the consumer of the events Queue', () => {
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
