import type { schemas } from '@hollware/core'
import type * as z from 'zod'
import { createD1Store } from '../../src/db/index.ts'
import type { OperationContext } from '../../src/ops/types.ts'
import type { ContentStore } from '../../src/ports.ts'
import { fixedClock } from '../db/support.ts'
import {
  agent,
  BINDING,
  blogPost,
  contextFor,
  newTenant,
  type ContextOptions,
  type Tenant,
} from './support.ts'

/**
 * A tenant with the real D1 store, a clock the test moves, and the callers of the handlers:
 * one that writes over MCP (the `head` view) and one that reads the way an RPC binding does (the
 * `published` view). Only for tests that run in workerd, where `db` comes from.
 */

export interface World {
  readonly db: D1Database
  readonly tenant: Tenant
  readonly store: ContentStore
  readonly time: { readonly clock: ContextOptions['clock']; set(time: string): void }
  /** The context of a call of the tenant; the options override what an MCP call would have. */
  context(options?: Partial<ContextOptions>, store?: ContentStore): OperationContext
  /** An agent that calls the operations over MCP: the `head` view, with every scope. */
  readonly agent: ReturnType<typeof agent>
  /** A site that reads over the RPC binding: the `published` view, and a principal that reads only. */
  readonly reader: ReturnType<typeof agent>
}

export const START = '2026-10-13T10:00:00.000Z'

export async function newWorld(db: D1Database, label: string): Promise<World> {
  const tenant = await newTenant(db, label)
  const time = fixedClock(START)
  const store = createD1Store(db, { clock: time.clock })
  const context = (options: Partial<ContextOptions> = {}, over: ContentStore = store) =>
    contextFor(tenant, over, { clock: time.clock, ...options })
  return {
    db,
    tenant,
    store,
    time,
    context,
    agent: agent(context()),
    reader: agent(context({ view: 'published', principal: BINDING })),
  }
}

/** What a revision holds in the database, with the names of its columns. */
export interface RevisionRow {
  readonly id: string
  readonly markdown: string
  readonly frontmatter: string
  readonly comark_version: string
  readonly pipeline_version: string
  readonly word_count: number
  readonly verdict: string
  readonly actor_kind: string
  readonly actor_user_id: string
  readonly actor_token_id: string | null
  readonly actor_meta: string | null
  readonly created_at: string
}

/** The revisions of an entry, oldest first. */
export async function revisionsOf(db: D1Database, entryId: string): Promise<RevisionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, markdown, frontmatter, comark_version, pipeline_version, word_count, verdict,
        actor_kind, actor_user_id, actor_token_id, actor_meta, created_at
        FROM revisions WHERE entry_id = ? ORDER BY rowid`,
    )
    .bind(entryId)
    .all<RevisionRow>()
  return results
}

/** What a publication holds in the database. */
export interface PublicationRow {
  readonly action: string
  readonly revision_id: string | null
  readonly verdict: string | null
  readonly acknowledged: string
  readonly actor_kind: string
  readonly actor_user_id: string
  readonly actor_token_id: string | null
  readonly actor_meta: string | null
  readonly created_at: string
}

/** The publications of an entry, oldest first. */
export async function publicationsOf(db: D1Database, entryId: string): Promise<PublicationRow[]> {
  const { results } = await db
    .prepare(
      `SELECT action, revision_id, verdict, acknowledged, actor_kind, actor_user_id,
        actor_token_id, actor_meta, created_at
        FROM publications WHERE entry_id = ? ORDER BY rowid`,
    )
    .bind(entryId)
    .all<PublicationRow>()
  return results
}

/** The columns of an entry that a write moves. */
export interface EntryColumns {
  readonly status: string
  readonly version: number
  readonly head_rev: string
  readonly published_rev: string | null
  readonly published_at: string | null
  readonly published_sort_key: string | null
  readonly translation_group: string | null
  readonly updated_at: string
}

export async function entryColumns(db: D1Database, entryId: string): Promise<EntryColumns | null> {
  return db
    .prepare(
      `SELECT status, version, head_rev, published_rev, published_at, published_sort_key,
        translation_group, updated_at FROM entries WHERE id = ?`,
    )
    .bind(entryId)
    .first<EntryColumns>()
}

/** Everything of a site that a write could change: its entries, and how many rows of each child table. */
export async function snapshotOf(db: D1Database, site: string) {
  const { results: entries } = await db
    .prepare(
      `SELECT id, status, version, head_rev, published_rev, published_at, published_sort_key,
        translation_group, updated_at FROM entries WHERE site_id = ? ORDER BY id`,
    )
    .bind(site)
    .all()
  const counts: Record<string, number | null> = {}
  for (const table of ['revisions', 'revision_tags', 'publications']) {
    counts[table] = await db
      .prepare(`SELECT count(*) AS n FROM ${table} WHERE site_id = ?`)
      .bind(site)
      .first<number>('n')
  }
  return { entries, counts }
}

type Summary = z.output<typeof schemas.entrySummary>

export interface PostOptions {
  readonly slug: string
  readonly locale?: 'en' | 'es'
  /** The translation group; the slug when absent. */
  readonly group?: string
  /** The tags as YAML, such as `[cloudflare, cms]`. */
  readonly tags?: string
  readonly title?: string
  readonly date?: string
  /** The time of the write, when the test sets one. */
  readonly at?: string
}

/** Writes a valid post of the blog as a draft and gives its summary. */
export async function createPost(world: World, options: PostOptions): Promise<Summary> {
  if (options.at !== undefined) world.time.set(options.at)
  const created = await world.agent.createDraft({
    collection: 'blog',
    locale: options.locale ?? 'en',
    slug: options.slug,
    markdown: blogPost({
      title: options.title ?? `Post ${options.slug}`,
      date: options.date ?? '2026-10-01',
      tags: options.tags ?? '[cloudflare]',
      translationGroup: options.group ?? options.slug,
    }),
  })
  if (created.outcome !== 'saved' || created.entry === undefined) {
    throw new Error(`createPost did not save ${options.slug}: ${JSON.stringify(created)}`)
  }
  return created.entry
}

/** Publishes an entry at the version it is at, and gives its summary. */
export async function publishPost(world: World, entry: Summary, at?: string): Promise<Summary> {
  if (at !== undefined) world.time.set(at)
  const published = await world.agent.publish({ id: entry.id, version: entry.version })
  if (published.outcome !== 'published' || published.entry === undefined) {
    throw new Error(`publishPost did not publish ${entry.slug}: ${JSON.stringify(published)}`)
  }
  return published.entry
}

/**
 * The store with another write let in just before the write of an operation, which is what a
 * second agent does between the read of the first and its write: the competing write goes through
 * the real store, so the answer to the operation is the store's own `conflict`.
 */
export function interleaved(
  store: ContentStore,
  before: 'appendRevision' | 'publish',
  intervene: () => Promise<unknown>,
): ContentStore {
  return {
    ...store,
    appendRevision: async (site, write) => {
      if (before === 'appendRevision') await intervene()
      return store.appendRevision(site, write)
    },
    publish: async (site, write) => {
      if (before === 'publish') await intervene()
      return store.publish(site, write)
    },
  }
}
