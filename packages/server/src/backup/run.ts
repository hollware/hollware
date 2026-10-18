import type { Backups } from '../ports.ts'

/**
 * The daily backup of a site to R2: one JSON file a day, `backups/<site>/<YYYY-MM-DD>.json`, with
 * the definition of the site and every entry, its latest Markdown and, when it differs, the one
 * that is published. The Markdown is the source of truth (ADR-001), so a backup is everything
 * needed to make the site again with `hollware backup get` and `hollware import`. D1 Time Travel
 * keeps 30 days of the database; this keeps the content apart from it, in the bucket of the
 * images, which the Worker never serves from `backups/`.
 */

/** How many days of backups are kept. */
export const BACKUP_RETENTION_DAYS = 30

/** The hour (UTC) from which the backup of the day is made, by the first run of the cron. */
export const BACKUP_HOUR_UTC = 3

/** The part of R2 a backup needs. */
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

/** One entry as a backup holds it. */
export interface BackupEntry {
  readonly id: string
  readonly collection: string
  readonly locale: string
  readonly slug: string
  readonly status: string
  readonly translationGroup: string | null
  readonly deletedAt: string | null
  readonly markdown: string
  /** The published Markdown when it is not the latest; `null` otherwise. */
  readonly published: string | null
}

/** What a backup file holds. */
export interface Backup {
  readonly hollware: 'backup/1'
  readonly site: string
  readonly at: string
  readonly definition: unknown
  readonly entries: readonly BackupEntry[]
}

export const backupKey = (site: string, date: string) => `backups/${site}/${date}.json`

/** The backups of a site, newest first: the date of each and its size. */
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

/** The backups of a bucket, as the operations see them. */
export const backupsIn = (bucket: BackupBucket): Backups => ({
  list: (site) => listBackups(bucket, site),
})

/**
 * Makes the backup of the day once its hour has come and there is none yet, then drops the ones
 * past the retention. Answers what it did, for the log.
 */
export async function backUpSite(
  db: D1Database,
  bucket: BackupBucket,
  site: string,
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
  const cutoff = new Date(now.getTime() - BACKUP_RETENTION_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const old = (await listBackups(bucket, site)).filter((backup) => backup.date < cutoff)
  if (old.length > 0) await bucket.delete(old.map((backup) => backupKey(site, backup.date)))
  return 'made'
}
