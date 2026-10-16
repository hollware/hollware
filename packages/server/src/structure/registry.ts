import {
  compileSites,
  ConfigError,
  newId,
  type ResolvedSite,
  type SiteDefinitionInput,
} from '@hollware/core'
import type { D1Like } from '../db/d1.ts'

/**
 * The sites a Worker serves, read from D1 (ADR-033). It is the `ReadonlyMap` of sites the rest of
 * the server has always read, kept current by `refresh`: each request, call and cron run starts
 * with it, and it asks D1 for the version of every site (one small query, at most once a second
 * per isolate), then reads and compiles again only a site whose version moved. A site whose
 * definition no longer compiles keeps its last good copy, and the problem is logged.
 *
 * A Worker given the config of 0.x moves it, once: a site of the config whose row has no
 * definition gets the config's as its first (version 1), with a change of no actor.
 */

/** How long a poll of the versions holds, in milliseconds. */
export const POLL_MS = 1_000

interface Compiled {
  readonly version: number
  readonly site: ResolvedSite
}

interface VersionRow {
  readonly id: string
  readonly version: number
  readonly served: number
}

export interface SiteRegistryOptions {
  /** The sites of a 0.x config, as definitions, to move into D1 on the first refresh. */
  readonly seed?: Readonly<Record<string, SiteDefinitionInput>>
  readonly now: () => Date
  readonly log: (entry: object) => void
  readonly pollMs?: number
}

export interface SiteRegistry {
  /** The served sites, by key: one map that `refresh` keeps current, in place. */
  readonly sites: ReadonlyMap<string, ResolvedSite>
  /** Their keys, kept current with them. */
  readonly keys: ReadonlySet<string>
  /** Brings the sites in line with D1: at once with `force`, else when the last poll is stale. */
  refresh(db: D1Like, options?: { readonly force?: boolean }): Promise<void>
}

async function moveConfig(
  db: D1Like,
  seed: Readonly<Record<string, SiteDefinitionInput>>,
  now: string,
): Promise<void> {
  const statements = Object.entries(seed).flatMap(([key, definition]) => {
    const json = JSON.stringify(definition)
    return [
      db
        .prepare(
          `INSERT INTO sites (id, definition, version, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?3)
           ON CONFLICT (id) DO UPDATE SET definition = excluded.definition, version = 1, updated_at = excluded.updated_at
           WHERE sites.definition IS NULL`,
        )
        .bind(key, json, now),
      // The change that made version 1, unless another isolate wrote it first.
      db
        .prepare(
          `INSERT OR IGNORE INTO site_changes (id, site_id, version, actor_user_id, actor_meta, before, after, created_at, updated_at)
           SELECT ?1, ?2, 1, NULL, NULL, NULL, definition, ?3, ?3 FROM sites WHERE id = ?2 AND version = 1`,
        )
        .bind(newId('sit'), key, now),
    ]
  })
  if (statements.length > 0) await db.batch(statements)
}

export function createSiteRegistry(options: SiteRegistryOptions): SiteRegistry {
  const pollMs = options.pollMs ?? POLL_MS
  const sites = new Map<string, ResolvedSite>()
  const keys = new Set<string>()
  let compiled = new Map<string, Compiled>()
  let polledAt = Number.NEGATIVE_INFINITY
  let moved = options.seed === undefined

  const refresh = async (db: D1Like, refreshOptions: { readonly force?: boolean } = {}) => {
    const now = options.now()
    if (refreshOptions.force !== true && now.getTime() - polledAt < pollMs) return
    if (!moved && options.seed !== undefined) {
      await moveConfig(db, options.seed, now.toISOString())
      moved = true
    }
    const { results: versions } = await db
      .prepare(
        'SELECT id, version, (definition IS NOT NULL AND deleted_at IS NULL) AS served FROM sites',
      )
      .all<VersionRow>()
    const stale = versions.filter(
      (row) => row.served === 1 && compiled.get(row.id)?.version !== row.version,
    )
    const fetched =
      stale.length === 0
        ? []
        : (
            await db
              .prepare(
                `SELECT id, version, definition FROM sites WHERE id IN (${stale.map((_, index) => `?${index + 1}`).join(', ')})`,
              )
              .bind(...stale.map((row) => row.id))
              .all<{ id: string; version: number; definition: string | null }>()
          ).results
    // What another request of this isolate made current while this one waited is kept: a copy
    // only ever moves to a newer version.
    const next = new Map<string, Compiled>()
    for (const row of versions) {
      const current = compiled.get(row.id)
      if (row.served === 1 && current !== undefined && current.version >= row.version) {
        next.set(row.id, current)
      }
    }
    for (const row of fetched) {
      if (row.definition === null || (next.get(row.id)?.version ?? -1) >= row.version) continue
      try {
        const definition: unknown = JSON.parse(row.definition)
        const site = compileSites({ [row.id]: definition }).sites.get(row.id)
        if (site !== undefined) next.set(row.id, { version: row.version, site })
      } catch (error) {
        options.log({
          kind: 'site_definition_invalid',
          site: row.id,
          version: row.version,
          message: error instanceof ConfigError ? error.message : String(error),
        })
        const previous = compiled.get(row.id)
        if (previous !== undefined) next.set(row.id, previous)
      }
    }
    // In place and at once: every holder of the map and the set sees the same sites.
    compiled = next
    sites.clear()
    keys.clear()
    for (const [key, value] of next) {
      sites.set(key, value.site)
      keys.add(key)
    }
    polledAt = now.getTime()
  }

  return { sites, keys, refresh }
}
