import type { ResolvedSite } from '@hollware/core'
import type { Backups } from '../ports.ts'

export const BACKUP_HOUR_UTC = 3

export interface BackupBucket {
  head(key: string): Promise<unknown>
  put(
    key: string,
    value: string,
    options: { readonly httpMetadata: { readonly contentType: string } },
  ): Promise<unknown>
  list(options: { readonly prefix: string; readonly cursor?: string }): Promise<{
    readonly objects: readonly {
      readonly key: string
      readonly size: number
      readonly uploaded: Date
    }[]
    readonly truncated: boolean
    readonly cursor?: string
  }>
  delete(keys: string | string[]): Promise<unknown>
}

export interface BackupEntry {
  readonly id: string
  readonly collection: string
  readonly locale: string
  readonly slug: string
  readonly status: string
  readonly translationGroup: string | null
  readonly deletedAt: string | null
  readonly markdown: string
  readonly published: string | null
}

export interface Backup {
  readonly hollware: 'backup/1'
  readonly site: string
  readonly at: string
  readonly definition: unknown
  readonly entries: readonly BackupEntry[]
}

export const backupKey = (site: string, date: string) => `backups/${site}/${date}.json`

export async function listBackups(
  bucket: BackupBucket,
  site: string,
): Promise<{ readonly date: string; readonly bytes: number }[]> {
  const found: { date: string; bytes: number }[] = []
  let cursor: string | undefined
  do {
    const page = await bucket.list({
      prefix: `backups/${site}/`,
      ...(cursor === undefined ? {} : { cursor }),
    })
    for (const object of page.objects) {
      const date = /\/(\d{4}-\d{2}-\d{2})\.json$/.exec(object.key)?.[1]
      if (date !== undefined) found.push({ date, bytes: object.size })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor !== undefined)
  return found.sort((a, b) => b.date.localeCompare(a.date))
}

export const backupsIn = (bucket: BackupBucket): Backups => ({
  list: (site) => listBackups(bucket, site),
})

async function dropOld(
  bucket: BackupBucket,
  site: string,
  retentionDays: number,
  now: Date,
): Promise<void> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString().slice(0, 10)
  const old = (await listBackups(bucket, site)).filter((backup) => backup.date < cutoff)
  if (old.length > 0) await bucket.delete(old.map((backup) => backupKey(site, backup.date)))
}

export async function backUpSite(
  db: D1Database,
  bucket: BackupBucket,
  site: Pick<ResolvedSite, 'key' | 'backups'>,
  now: Date,
): Promise<'made' | 'not_yet' | 'done' | 'off'> {
  if (!site.backups.enabled) {
    if (now.getUTCHours() === BACKUP_HOUR_UTC && now.getUTCMinutes() < 5) {
      await dropOld(bucket, site.key, site.backups.retentionDays, now)
    }
    return 'off'
  }
  return backUp(db, bucket, site.key, site.backups.retentionDays, now)
}

async function backUp(
  db: D1Database,
  bucket: BackupBucket,
  site: string,
  retentionDays: number,
  now: Date,
): Promise<'made' | 'not_yet' | 'done'> {
  if (now.getUTCHours() < BACKUP_HOUR_UTC) return 'not_yet'
  const date = now.toISOString().slice(0, 10)
  const key = backupKey(site, date)
  if ((await bucket.head(key)) !== null) return 'done'
  const row = await db
    .prepare('SELECT definition FROM sites WHERE id = ?1')
    .bind(site)
    .first<{ definition: string | null }>()
  const { results } = await db
    .prepare(
      `SELECT e.id AS id, e.collection AS collection, e.locale AS locale, e.slug AS slug,
              e.status AS status, e.translation_group AS translationGroup, e.deleted_at AS deletedAt,
              h.markdown AS markdown,
              CASE WHEN e.published_rev IS NOT NULL AND e.published_rev <> e.head_rev
                   THEN (SELECT p.markdown FROM revisions AS p WHERE p.id = e.published_rev AND p.site_id = e.site_id)
                   ELSE NULL END AS published
         FROM entries AS e JOIN revisions AS h ON h.id = e.head_rev AND h.site_id = e.site_id
        WHERE e.site_id = ?1
        ORDER BY e.collection, e.locale, e.slug`,
    )
    .bind(site)
    .all<BackupEntry>()
  const backup: Backup = {
    hollware: 'backup/1',
    site,
    at: now.toISOString(),
    definition: row?.definition === null || row === null ? null : JSON.parse(row.definition),
    entries: results,
  }
  await bucket.put(key, JSON.stringify(backup), {
    httpMetadata: { contentType: 'application/json' },
  })
  await dropOld(bucket, site, retentionDays, now)
  return 'made'
}
