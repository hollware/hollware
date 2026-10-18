import { env } from 'cloudflare:workers'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { backupKey, backUpSite, type Backup } from '../../src/backup/run.ts'
import { listBackups } from '../../src/ops/backups.ts'
import { backupsIn } from '../../src/backup/run.ts'
import { seedToken } from '../auth/support.ts'
import { boot, restoreLogs, SITE_KEY } from '../http/support.ts'
import { warmUpComark } from '../ops/support.ts'
import { createPost, newWorld, publishPost } from '../ops/world.ts'

// Fails when: the daily backup (src/backup/run.ts) is made before its hour, more than once a day,
// without an entry's latest Markdown or the published one when it differs, or keeps one past 30
// days; or list_backups stops listing them newest first, or answers without the bucket; or
// GET /v1/backups/<date> serves one to anyone but a token with schema:admin of the site.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)
afterEach(() => {
  restoreLogs()
})

const at = (iso: string) => new Date(iso)

describe('the daily backup', () => {
  it('is made once a day after its hour, with every entry, and keeps 30 days', async () => {
    const world = await newWorld(env.DB, 'backup')
    const site = world.tenant.key
    const en = await createPost(world, { slug: 'kept', group: 'kept' })
    await createPost(world, { slug: 'guardado', locale: 'es', group: 'kept' })
    const live = await publishPost(world, en)
    await world.agent.updateDraft({
      id: en.id,
      version: live.version,
      markdown:
        '---\ntitle: Changed\ndescription: d\ndate: 2026-10-01\ntags: [a]\ntranslationGroup: kept\n---\nChanged.\n',
    })
    // A backup older than the retention, which the run of the day drops.
    await env.MEDIA.put(backupKey(site, '2026-09-01'), '{}')

    const early = await backUpSite(env.DB, env.MEDIA, site, at('2026-10-18T02:59:00.000Z'))
    const made = await backUpSite(env.DB, env.MEDIA, site, at('2026-10-18T03:00:00.000Z'))
    const again = await backUpSite(env.DB, env.MEDIA, site, at('2026-10-18T09:00:00.000Z'))

    expect([early, made, again]).toEqual(['not_yet', 'made', 'done'])
    const object = await env.MEDIA.get(backupKey(site, '2026-10-18'))
    const backup: Backup = JSON.parse((await object?.text()) ?? '{}')
    expect([backup.hollware, backup.site, backup.at]).toEqual([
      'backup/1',
      site,
      '2026-10-18T03:00:00.000Z',
    ])
    expect(
      backup.entries.map((entry) => [
        entry.locale,
        entry.slug,
        entry.markdown.includes('Changed'),
        entry.published === null,
      ]),
    ).toEqual([
      ['en', 'kept', true, false],
      ['es', 'guardado', false, true],
    ])
    expect(await env.MEDIA.head(backupKey(site, '2026-09-01'))).toBeNull()
  })

  it('is listed newest first, and is unavailable without the bucket', async () => {
    const world = await newWorld(env.DB, 'backup-list')
    const site = world.tenant.key
    await backUpSite(env.DB, env.MEDIA, site, at('2026-10-16T05:00:00.000Z'))
    await backUpSite(env.DB, env.MEDIA, site, at('2026-10-17T05:00:00.000Z'))

    const listed = await listBackups({}, { ...world.context(), backups: backupsIn(env.MEDIA) })
    const none = await listBackups({}, { ...world.context(), backups: null })

    expect(listed.backups?.map((backup) => backup.date)).toEqual(['2026-10-17', '2026-10-16'])
    expect(none.outcome).toBe('unavailable')
  })
})

describe('GET /v1/backups/<date>', () => {
  it('serves a backup to an owner of the site, and to no one else', async () => {
    const owner = await seedToken(env.DB, SITE_KEY, { expiresAt: '2026-12-01T00:00:00.000Z' })
    const writer = await seedToken(env.DB, SITE_KEY, {
      expiresAt: '2026-12-01T00:00:00.000Z',
      scopes: ['content:read', 'content:write', 'content:publish'],
    })
    await env.MEDIA.put(backupKey(SITE_KEY, '2026-10-18'), '{"hollware":"backup/1"}')
    const worker = boot({ bindings: { MEDIA: env.MEDIA } })

    const mine = await worker.send('/v1/backups/2026-10-18', { token: owner.token })
    const missing = await worker.send('/v1/backups/2026-10-19', { token: owner.token })
    const none = await worker.send('/v1/backups/2026-10-18')
    const unscoped = await worker.send('/v1/backups/2026-10-18', { token: writer.token })

    expect([mine.status, missing.status, none.status, unscoped.status]).toEqual([
      200, 404, 401, 403,
    ])
    expect(await mine.text()).toBe('{"hollware":"backup/1"}')
    expect(mine.headers.get('cache-control')).toBe('private, no-store')
    expect(unscoped.headers.get('www-authenticate')).toContain('scope="schema:admin"')
  })
})
