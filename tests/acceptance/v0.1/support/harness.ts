import type { TestHarness } from 'wrangler'
import { newId } from '../../../../packages/core/src/ids.ts'
import { generatePersonalToken, hashPersonalToken } from '../../../../packages/core/src/tokens.ts'
import { SITE_KEY } from '../../../../apps/playground/test/harness/support.ts'
import { HOLLWARE_WORKER } from '../../../../apps/playground/test/harness/workers.ts'

export {
  createHarnessWithoutPublicUrl,
  createPlaygroundHarness,
  HOLLWARE_URL,
  PAGE_SIZE,
  SITE_URL,
  SITE_WORKER,
  siteFetch,
} from '../../../../apps/playground/test/harness/workers.ts'
export {
  agentWith,
  createDraft,
  migrate,
  publishNew,
  seedOwnerToken,
  SITE_KEY,
  type Agent,
  type ToolAnswer,
} from '../../../../apps/playground/test/harness/support.ts'

interface Statement {
  bind(...values: unknown[]): Statement
  first(): Promise<unknown>
}

interface Database {
  prepare(sql: string): Statement
  batch(statements: Statement[]): Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function database(server: TestHarness): Promise<Database> {
  const env = await server.getWorker<{ DB: Database }>(HOLLWARE_WORKER).getEnv()
  return env.DB
}

export interface TokenOptions {
  readonly scopes: readonly string[]
  readonly expiresAt?: string
  readonly revokedAt?: string
}

export async function seedToken(server: TestHarness, options: TokenOptions): Promise<string> {
  const db = await database(server)
  const owner = await db
    .prepare('SELECT user_id AS id FROM members WHERE role = ?1')
    .bind('owner')
    .first()
  if (!isRecord(owner) || typeof owner['id'] !== 'string') {
    throw new Error('the database has no owner: seed one with seedOwnerToken first')
  }
  const now = new Date().toISOString()
  const token = generatePersonalToken()
  await db.batch([
    db
      .prepare(
        `INSERT INTO tokens (id, site_id, user_id, label, hash, scopes, expires_at, revoked_at,
          created_at, updated_at) VALUES (?1, ?2, ?3, 'acceptance', ?4, ?5, ?6, ?7, ?8, ?8)`,
      )
      .bind(
        newId('tok'),
        SITE_KEY,
        owner['id'],
        await hashPersonalToken(token),
        JSON.stringify(options.scopes),
        options.expiresAt ?? null,
        options.revokedAt ?? null,
        now,
      ),
  ])
  return token
}

export interface ForeignEntry {
  readonly id: string
  readonly locale: 'en' | 'es'
  readonly slug: string
  readonly translationGroup: string
  readonly published: boolean
}

const FOREIGN = [
  { locale: 'en', slug: 'edge-caching-basics', group: 'edge-caching', published: true },
  { locale: 'es', slug: 'cache-en-el-borde', group: 'edge-caching', published: true },
  { locale: 'en', slug: 'from-draft-to-published', group: 'publishing-flow', published: false },
] as const

const VERDICT = JSON.stringify({
  ok: true,
  phase: 'write',
  errors: [],
  warnings: [],
  contractsHash: 'seed',
})

export async function seedForeignSite(server: TestHarness, site: string): Promise<ForeignEntry[]> {
  const db = await database(server)
  const now = new Date().toISOString()
  const userId = newId('usr')
  const tokenId = newId('tok')
  const statements: Statement[] = [
    db
      .prepare('INSERT INTO sites (id, created_at, updated_at) VALUES (?1, ?2, ?2)')
      .bind(site, now),
    db
      .prepare(
        "INSERT INTO users (id, name, role, created_at, updated_at) VALUES (?1, 'Other owner', 'owner', ?2, ?2)",
      )
      .bind(userId, now),
    db
      .prepare(
        `INSERT INTO tokens (id, site_id, user_id, label, hash, scopes, created_at, updated_at)
          VALUES (?1, ?2, ?3, 'other', ?4, '["content:read"]', ?5, ?5)`,
      )
      .bind(tokenId, site, userId, await hashPersonalToken(generatePersonalToken()), now),
  ]
  const entries: ForeignEntry[] = []
  for (const seed of FOREIGN) {
    const entry: ForeignEntry = {
      id: newId('ent'),
      locale: seed.locale,
      slug: seed.slug,
      translationGroup: seed.group,
      published: seed.published,
    }
    entries.push(entry)
    const revisionId = newId('rev')
    const markdown = `---\ntitle: Another site's ${seed.slug}\ndescription: Not the playground's.\ndate: 2026-09-01\ntags:\n  - cms\ntranslationGroup: ${seed.group}\n---\n\nAnother site.\n`
    statements.push(
      db
        .prepare(
          `INSERT INTO entries (id, site_id, collection, locale, slug, translation_group, status,
            version, head_rev, published_rev, published_at, published_sort_key, created_at, updated_at)
            VALUES (?1, ?2, 'blog', ?3, ?4, ?5, ?6, 1, ?7, ?8, ?9, ?9, ?10, ?10)`,
        )
        .bind(
          entry.id,
          site,
          entry.locale,
          entry.slug,
          entry.translationGroup,
          seed.published ? 'published' : 'draft',
          revisionId,
          seed.published ? revisionId : null,
          seed.published ? now : null,
          now,
        ),
      db
        .prepare(
          `INSERT INTO revisions (id, site_id, entry_id, markdown, frontmatter, document,
            comark_version, pipeline_version, word_count, verdict, actor_kind, actor_user_id,
            actor_token_id, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, '{}', '{"nodes":[],"frontmatter":{},"meta":{}}', 'seed', 'seed',
              2, ?5, 'token', ?6, ?7, ?8, ?8)`,
        )
        .bind(revisionId, site, entry.id, markdown, VERDICT, userId, tokenId, now),
      db
        .prepare(
          `INSERT INTO revision_tags (id, site_id, revision_id, tag, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'cms', ?4, ?4)`,
        )
        .bind(newId('tag'), site, revisionId, now),
    )
    if (seed.published) {
      statements.push(
        db
          .prepare(
            `INSERT INTO publications (id, site_id, entry_id, action, revision_id, verdict,
              acknowledged, actor_kind, actor_user_id, actor_token_id, created_at, updated_at)
              VALUES (?1, ?2, ?3, 'publish', ?4, ?5, '[]', 'token', ?6, ?7, ?8, ?8)`,
          )
          .bind(newId('pub'), site, entry.id, revisionId, VERDICT, userId, tokenId, now),
      )
    }
  }
  await db.batch(statements)
  return entries
}
