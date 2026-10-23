import { generatePersonalToken, hashPersonalToken, newId } from '@hollware/core'

import { contentFixture } from '../../../../tests/fixtures/content.ts'

export interface SeededEntry {
  readonly id: string
  readonly collection: 'blog'
  readonly locale: 'en' | 'es'
  readonly slug: string
  readonly translationGroup: string | null
  readonly status: 'draft' | 'published'
  readonly revisionId: string
}

export interface SeededSite {
  readonly site: string
  readonly userId: string
  readonly tokenId: string
  readonly token: string
  readonly entries: readonly SeededEntry[]
}

const SEEDED = [
  { locale: 'en', slug: 'edge-caching-basics', group: 'edge-caching', status: 'published' },
  { locale: 'es', slug: 'cache-en-el-borde', group: 'edge-caching', status: 'published' },
  { locale: 'en', slug: 'from-draft-to-published', group: 'publishing-flow', status: 'draft' },
] as const

const VERDICT = JSON.stringify({
  ok: true,
  phase: 'write',
  errors: [],
  warnings: [],
  contractsHash: 'seed',
})

export async function seedSite(db: D1Database, site: string): Promise<SeededSite> {
  const now = new Date().toISOString()
  const userId = newId('usr')
  const tokenId = newId('tok')
  const token = generatePersonalToken()
  const entries: SeededEntry[] = SEEDED.map((seed) => ({
    id: newId('ent'),
    collection: 'blog',
    locale: seed.locale,
    slug: seed.slug,
    translationGroup: seed.group,
    status: seed.status,
    revisionId: newId('rev'),
  }))
  const statements: D1PreparedStatement[] = [
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
          VALUES (?1, ?2, ?3, 'seed', ?4, ?5, ?6, ?6)`,
      )
      .bind(
        tokenId,
        site,
        userId,
        await hashPersonalToken(token),
        JSON.stringify(['content:read', 'content:write', 'content:publish', 'schema:admin']),
        now,
      ),
  ]
  for (const entry of entries) {
    const published = entry.status === 'published'
    const markdown = contentFixture(`blog/${entry.locale}/${entry.slug}.md`)
    statements.push(
      db
        .prepare(
          `INSERT INTO entries (id, site_id, collection, locale, slug, translation_group, status,
            version, head_rev, published_rev, published_at, published_sort_key, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?9, ?10, ?10, ?11, ?11)`,
        )
        .bind(
          entry.id,
          site,
          entry.collection,
          entry.locale,
          entry.slug,
          entry.translationGroup,
          entry.status,
          entry.revisionId,
          published ? entry.revisionId : null,
          published ? now : null,
          now,
        ),
      db
        .prepare(
          `INSERT INTO revisions (id, site_id, entry_id, markdown, frontmatter, document,
            comark_version, pipeline_version, word_count, verdict, actor_kind, actor_user_id,
            actor_token_id, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, '{}', '{"nodes":[],"frontmatter":{},"meta":{}}', 'seed', 'seed',
              0, ?5, 'token', ?6, ?7, ?8, ?8)`,
        )
        .bind(entry.revisionId, site, entry.id, markdown, VERDICT, userId, tokenId, now),
      db
        .prepare(
          `INSERT INTO revision_tags (id, site_id, revision_id, tag, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'cms', ?4, ?4)`,
        )
        .bind(newId('tag'), site, entry.revisionId, now),
    )
    if (published) {
      statements.push(
        db
          .prepare(
            `INSERT INTO publications (id, site_id, entry_id, action, revision_id, verdict,
              acknowledged, actor_kind, actor_user_id, actor_token_id, created_at, updated_at)
              VALUES (?1, ?2, ?3, 'publish', ?4, ?5, '[]', 'token', ?6, ?7, ?8, ?8)`,
          )
          .bind(newId('pub'), site, entry.id, entry.revisionId, VERDICT, userId, tokenId, now),
      )
    }
  }
  await db.batch(statements)
  return { site, userId, tokenId, token, entries }
}
