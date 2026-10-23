import { newId } from '@hollware/core'
import type { Verdict } from '@hollware/core'

import type { D1Like } from '../../src/db/index.ts'
import type { Actor, Clock, NewRevision } from '../../src/ports.ts'

export function siteKey(label: string): string {
  return `${label}-${crypto.randomUUID()}`
}

export function idFactory(): (name: string) => string {
  const unique = crypto.randomUUID().slice(0, 8)
  return (name) => `${name}_${unique}`
}

export interface Owner {
  readonly site: string
  readonly actor: Actor
}

export async function seedOwner(db: D1Database, site: string): Promise<Owner> {
  const now = '2026-10-12T09:00:00.000Z'
  const userId = newId('usr')
  const tokenId = newId('tok')
  await db.batch([
    db
      .prepare('INSERT INTO sites (id, created_at, updated_at) VALUES (?1, ?2, ?2)')
      .bind(site, now),
    db
      .prepare(
        "INSERT INTO users (id, name, role, created_at, updated_at) VALUES (?1, 'Owner', 'owner', ?2, ?2)",
      )
      .bind(userId, now),
    db
      .prepare(
        "INSERT INTO members (id, site_id, user_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, 'owner', ?4, ?4)",
      )
      .bind(newId('mbr'), site, userId, now),
    db
      .prepare(
        `INSERT INTO tokens (id, site_id, user_id, label, hash, scopes, created_at, updated_at)
          VALUES (?1, ?2, ?3, 'test', ?4, '["content:write"]', ?5, ?5)`,
      )
      .bind(tokenId, site, userId, crypto.randomUUID(), now),
  ])
  return { site, actor: { kind: 'token', userId, tokenId, meta: null } }
}

export function fixedClock(start: string): { readonly clock: Clock; set(time: string): void } {
  let current = start
  return {
    clock: { now: () => new Date(current) },
    set(time) {
      current = time
    },
  }
}

export const VERDICT: Verdict = {
  ok: true,
  phase: 'write',
  errors: [],
  warnings: [],
  contractsHash: 'abc123',
}

export function newRevision(actor: Actor, overrides: Partial<NewRevision> = {}): NewRevision {
  return {
    markdown: '---\ntitle: Hello\n---\n\nHello world\n',
    frontmatter: { title: 'Hello' },
    document: { nodes: [['p', {}, 'Hello world']], frontmatter: { title: 'Hello' }, meta: {} },
    comarkVersion: '0.7.0',
    pipelineVersion: '1',
    wordCount: 2,
    codeWords: 0,
    verdict: VERDICT,
    tags: [],
    actor,
    ...overrides,
  }
}

export async function countRows(db: D1Database, table: string, site: string): Promise<number> {
  const count = await db
    .prepare(`SELECT count(*) AS n FROM ${table} WHERE site_id = ?`)
    .bind(site)
    .first<number>('n')
  return count ?? 0
}

export async function storedTags(db: D1Database, revisionId: string): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT tag FROM revision_tags WHERE revision_id = ? ORDER BY tag')
    .bind(revisionId)
    .all<{ tag: string }>()
  return results.map((row) => row.tag)
}

export async function entryRow(
  db: D1Database,
  id: string,
): Promise<Record<string, string | number | null> | null> {
  return db.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first()
}

export interface RevisionSpec {
  readonly id: string
  readonly markdown?: string
  readonly frontmatter?: Readonly<Record<string, unknown>>
  readonly document?: Readonly<Record<string, unknown>>
  readonly verdict?: Readonly<Record<string, unknown>>
  readonly wordCount?: number
  readonly actorMeta?: Readonly<Record<string, unknown>> | null
  readonly tags?: readonly string[]
  readonly createdAt?: string
}

export interface EntrySpec {
  readonly id: string
  readonly collection?: string
  readonly locale?: string
  readonly slug: string
  readonly translationGroup?: string | null
  readonly updatedAt: string
  readonly revisions?: readonly RevisionSpec[]
  readonly published?: {
    readonly revision: string
    readonly sortKey: string
    readonly at: string
  }
}

export async function insertEntries(
  db: D1Database,
  owner: Owner,
  specs: readonly EntrySpec[],
): Promise<void> {
  const statements: D1PreparedStatement[] = []
  for (const spec of specs) {
    const revisions = spec.revisions ?? [{ id: `rev_${spec.id}` }]
    const head = revisions.at(-1)
    if (head === undefined) throw new Error(`The entry ${spec.id} has no revision`)
    statements.push(
      db
        .prepare(
          `INSERT INTO entries (id, site_id, collection, locale, slug, translation_group, status,
            version, head_rev, published_rev, published_at, published_sort_key, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?9, ?10, ?11, ?12, ?12)`,
        )
        .bind(
          spec.id,
          owner.site,
          spec.collection ?? 'blog',
          spec.locale ?? 'en',
          spec.slug,
          spec.translationGroup ?? null,
          spec.published === undefined ? 'draft' : 'published',
          head.id,
          spec.published?.revision ?? null,
          spec.published?.at ?? null,
          spec.published?.sortKey ?? null,
          spec.updatedAt,
        ),
    )
    for (const revision of revisions) {
      const createdAt = revision.createdAt ?? spec.updatedAt
      statements.push(
        db
          .prepare(
            `INSERT INTO revisions (id, site_id, entry_id, markdown, frontmatter, document,
              comark_version, pipeline_version, word_count, verdict, actor_kind, actor_user_id,
              actor_token_id, actor_meta, created_at, updated_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, '0.7.0', '1', ?7, ?8, 'token', ?9, ?10, ?11, ?12, ?12)`,
          )
          .bind(
            revision.id,
            owner.site,
            spec.id,
            revision.markdown ?? `# ${spec.slug}`,
            JSON.stringify(revision.frontmatter ?? { title: spec.slug }),
            JSON.stringify(revision.document ?? { nodes: [], frontmatter: {}, meta: {} }),
            revision.wordCount ?? 1,
            JSON.stringify(revision.verdict ?? VERDICT),
            owner.actor.userId,
            owner.actor.tokenId,
            revision.actorMeta === undefined || revision.actorMeta === null
              ? null
              : JSON.stringify(revision.actorMeta),
            createdAt,
          ),
      )
      for (const tag of revision.tags ?? []) {
        statements.push(
          db
            .prepare(
              `INSERT INTO revision_tags (id, site_id, revision_id, tag, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
            )
            .bind(newId('tag'), owner.site, revision.id, tag, createdAt),
        )
      }
    }
    if (spec.published !== undefined) {
      statements.push(
        db
          .prepare(
            `INSERT INTO publications (id, site_id, entry_id, action, revision_id, verdict,
              acknowledged, actor_kind, actor_user_id, actor_token_id, created_at, updated_at)
              VALUES (?1, ?2, ?3, 'publish', ?4, ?5, '[]', 'token', ?6, ?7, ?8, ?8)`,
          )
          .bind(
            newId('pub'),
            owner.site,
            spec.id,
            spec.published.revision,
            JSON.stringify({ ...VERDICT, phase: 'publish' }),
            owner.actor.userId,
            owner.actor.tokenId,
            spec.published.at,
          ),
      )
    }
  }
  await db.batch(statements)
}

export function recordStatements(target: D1Database): {
  readonly db: D1Like
  readonly prepared: string[]
  readonly batches: number[]
} {
  const prepared: string[] = []
  const batches: number[] = []
  return {
    prepared,
    batches,
    db: {
      prepare(query) {
        prepared.push(query)
        return target.prepare(query)
      },
      batch<T = unknown>(statements: D1PreparedStatement[]) {
        batches.push(statements.length)
        return target.batch<T>(statements)
      },
    },
  }
}

export function placeholders(sql: string): number {
  return sql.match(/\?/g)?.length ?? 0
}
