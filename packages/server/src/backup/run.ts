import type { ResolvedSite } from '@hollware/core'
import { widthsOf } from '../media/cloudflare.ts'
import { entryPath } from '../ops/event.ts'
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

export interface BackupRedirect {
  readonly collection: string
  readonly locale: string
  readonly from: string
  readonly to: string
  readonly fromPath: string | null
  readonly toPath: string | null
  readonly entryId: string
}

export interface BackupAsset {
  readonly id: string
  readonly sha256: string
  readonly format: string
  readonly width: number | null
  readonly height: number | null
  readonly bytes: number
  readonly widths: readonly number[]
  readonly originalFormat: string
  readonly originalBytes: number
  readonly alt: string
  readonly filename: string
  readonly createdAt: string
}

export interface Backup {
  readonly hollware: 'backup/2'
  readonly site: string
  readonly at: string
  readonly definition: unknown
  readonly entries: readonly BackupEntry[]
  readonly redirects: readonly BackupRedirect[]
  readonly assets: readonly BackupAsset[]
}

export const backupBucketOf = <Bucket>(env: {
  readonly BACKUPS?: Bucket
  readonly MEDIA?: Bucket
}): Bucket | undefined => env.BACKUPS ?? env.MEDIA

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

export function backupsOf(env: {
  readonly BACKUPS?: BackupBucket
  readonly MEDIA?: BackupBucket
}): Backups | null {
  const bucket = backupBucketOf(env)
  return bucket === undefined ? null : backupsIn(bucket)
}

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
  site: Pick<ResolvedSite, 'key' | 'backups' | 'collections'>,
  now: Date,
): Promise<'made' | 'not_yet' | 'done' | 'off'> {
  if (!site.backups.enabled) {
    if (now.getUTCHours() === BACKUP_HOUR_UTC && now.getUTCMinutes() < 5) {
      await dropOld(bucket, site.key, site.backups.retentionDays, now)
    }
    return 'off'
  }
  return backUp(db, bucket, site, now)
}

async function redirectsOf(
  db: D1Database,
  site: Pick<ResolvedSite, 'key' | 'collections'>,
): Promise<BackupRedirect[]> {
  const { results } = await db
    .prepare(
      `SELECT r.collection AS collection, r.locale AS locale, r.from_slug AS "from", e.slug AS "to", r.entry_id AS entryId
         FROM redirects AS r JOIN entries AS e ON e.id = r.entry_id AND e.site_id = r.site_id
        WHERE r.site_id = ?1
        ORDER BY r.collection, r.locale, r.from_slug`,
    )
    .bind(site.key)
    .all<Omit<BackupRedirect, 'fromPath' | 'toPath'>>()
  return results.map((redirect) => {
    const collection = site.collections.get(redirect.collection)
    const path = (slug: string) =>
      collection === undefined ? null : entryPath(collection, redirect.locale, slug)
    return { ...redirect, fromPath: path(redirect.from), toPath: path(redirect.to) }
  })
}

async function assetsOf(db: D1Database, site: string): Promise<BackupAsset[]> {
  const { results } = await db
    .prepare(
      `SELECT id, sha256, format, width, height, bytes, widths, original_format AS originalFormat,
              original_bytes AS originalBytes, alt, filename, created_at AS createdAt
         FROM assets WHERE site_id = ?1 ORDER BY created_at, id`,
    )
    .bind(site)
    .all<Omit<BackupAsset, 'widths'> & { readonly widths: string }>()
  return results.map((asset) => ({ ...asset, widths: widthsOf(asset.widths) }))
}

async function backUp(
  db: D1Database,
  bucket: BackupBucket,
  resolved: Pick<ResolvedSite, 'key' | 'backups' | 'collections'>,
  now: Date,
): Promise<'made' | 'not_yet' | 'done'> {
  if (now.getUTCHours() < BACKUP_HOUR_UTC) return 'not_yet'
  const site = resolved.key
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
    hollware: 'backup/2',
    site,
    at: now.toISOString(),
    definition: row?.definition === null || row === null ? null : JSON.parse(row.definition),
    entries: results,
    redirects: await redirectsOf(db, resolved),
    assets: await assetsOf(db, site),
  }
  await bucket.put(key, JSON.stringify(backup), {
    httpMetadata: { contentType: 'application/json' },
  })
  await dropOld(bucket, site, resolved.backups.retentionDays, now)
  return 'made'
}
