import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'
import { id, siteId, timestamps } from './columns.ts'

/**
 * The D1 schema of Hollware v0.1. `drizzle-kit generate` turns it into the migrations of
 * `migrations/`, which ship with the package; `0002_append_only.sql` adds, by hand, the triggers
 * that keep revisions, their tags and publications append-only (ADR-021).
 *
 * Every site-scoped table has `site_id`, `UNIQUE(id, site_id)`, and composite foreign keys that
 * carry `site_id`, so a row can only point at rows of its own site. Entries point at their head
 * and published revisions without a foreign key: entries and revisions would reference each
 * other, and D1 cannot insert such a cycle, since it does not defer foreign keys.
 */

/** Created by the shipped migration `0000_init.sql`, which is never edited. Deployment metadata. */
export const hollwareMeta = sqliteTable('_hollware_meta', {
  key: text('key').primaryKey().notNull(),
  value: text('value').notNull(),
})

/** The sites of the deployment. The id is the site's key in `hollware.config.ts`. */
export const sites = sqliteTable('sites', {
  id: text('id').primaryKey(),
  ...timestamps(),
})

/** People. A user belongs to the deployment; tokens carry the site. */
export const users = sqliteTable(
  'users',
  {
    id: id('usr'),
    name: text('name'),
    role: text('role').notNull(),
    ...timestamps(),
  },
  (t) => [check('users_role', sql`${t.role} IN ('owner', 'editor', 'reviewer')`)],
)

/** Personal tokens (ADR-019): only the hash is stored. */
export const tokens = sqliteTable(
  'tokens',
  {
    id: id('tok'),
    siteId: siteId(),
    userId: text('user_id').notNull(),
    label: text('label').notNull(),
    hash: text('hash').notNull(),
    /** A JSON array of scopes. */
    scopes: text('scopes').notNull(),
    expiresAt: text('expires_at'),
    revokedAt: text('revoked_at'),
    lastUsedAt: text('last_used_at'),
    ...timestamps(),
  },
  (t) => [
    unique('tokens_id_site').on(t.id, t.siteId),
    unique('tokens_hash').on(t.hash),
    foreignKey({ name: 'tokens_site', columns: [t.siteId], foreignColumns: [sites.id] }),
    foreignKey({ name: 'tokens_user', columns: [t.userId], foreignColumns: [users.id] }),
    check('tokens_scopes', sql`json_valid(${t.scopes}) AND json_type(${t.scopes}) = 'array'`),
  ],
)

/** One entry per site, collection, locale and slug; its content lives in `revisions`. */
export const entries = sqliteTable(
  'entries',
  {
    id: id('ent'),
    siteId: siteId(),
    collection: text('collection').notNull(),
    locale: text('locale').notNull(),
    slug: text('slug').notNull(),
    translationGroup: text('translation_group'),
    status: text('status').notNull(),
    /** Bumped by every change of the entry: the optimistic write compares it. */
    version: integer('version').notNull(),
    headRev: text('head_rev').notNull(),
    publishedRev: text('published_rev'),
    publishedAt: text('published_at'),
    publishedSortKey: text('published_sort_key'),
    scheduledAt: text('scheduled_at'),
    ...timestamps(),
  },
  (t) => [
    unique('entries_id_site').on(t.id, t.siteId),
    unique('entries_slug').on(t.siteId, t.collection, t.locale, t.slug),
    unique('entries_translation').on(t.siteId, t.collection, t.translationGroup, t.locale),
    // Each listing reads its order from an index, the id breaking ties, so a page costs its own
    // rows and not a sort of the whole collection.
    index('entries_head').on(t.siteId, t.collection, t.updatedAt, t.id),
    index('entries_head_locale').on(t.siteId, t.collection, t.locale, t.updatedAt, t.id),
    index('entries_published')
      .on(t.siteId, t.collection, t.locale, t.publishedSortKey, t.id)
      .where(sql`${t.status} = 'published'`),
    foreignKey({ name: 'entries_site', columns: [t.siteId], foreignColumns: [sites.id] }),
    check('entries_status', sql`${t.status} IN ('draft', 'scheduled', 'published')`),
    check('entries_version', sql`${t.version} >= 1`),
    check(
      'entries_draft',
      sql`${t.status} <> 'draft' OR (${t.publishedRev} IS NULL AND ${t.publishedSortKey} IS NULL AND ${t.scheduledAt} IS NULL)`,
    ),
    check(
      'entries_published',
      sql`${t.status} <> 'published' OR (${t.publishedRev} IS NOT NULL AND ${t.publishedAt} IS NOT NULL AND ${t.publishedSortKey} IS NOT NULL)`,
    ),
    check('entries_scheduled', sql`${t.status} <> 'scheduled' OR ${t.scheduledAt} IS NOT NULL`),
  ],
)

/**
 * Every version of an entry, appended and never changed (ADR-021). `markdown` is the whole file,
 * frontmatter included; the derived columns can be rebuilt by `reparse`.
 */
export const revisions = sqliteTable(
  'revisions',
  {
    id: id('rev'),
    siteId: siteId(),
    entryId: text('entry_id').notNull(),
    markdown: text('markdown').notNull(),
    /** Derived: the frontmatter as JSON. */
    frontmatter: text('frontmatter').notNull(),
    /** Derived: the Comark document as JSON. */
    document: text('document').notNull(),
    comarkVersion: text('comark_version').notNull(),
    pipelineVersion: text('pipeline_version').notNull(),
    wordCount: integer('word_count').notNull(),
    /** The verdict of the contracts when the revision was written, as JSON. */
    verdict: text('verdict').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorUserId: text('actor_user_id').notNull(),
    actorTokenId: text('actor_token_id'),
    /** The client and, when it says, the model behind the write, as JSON. */
    actorMeta: text('actor_meta'),
    ...timestamps(),
  },
  (t) => [
    unique('revisions_id_site').on(t.id, t.siteId),
    index('revisions_entry').on(t.entryId, t.createdAt),
    foreignKey({ name: 'revisions_site', columns: [t.siteId], foreignColumns: [sites.id] }),
    foreignKey({
      name: 'revisions_entry',
      columns: [t.entryId, t.siteId],
      foreignColumns: [entries.id, entries.siteId],
    }),
    foreignKey({ name: 'revisions_user', columns: [t.actorUserId], foreignColumns: [users.id] }),
    foreignKey({
      name: 'revisions_token',
      columns: [t.actorTokenId, t.siteId],
      foreignColumns: [tokens.id, tokens.siteId],
    }),
    check('revisions_actor_kind', sql`${t.actorKind} IN ('token', 'user', 'oauth_client')`),
    check(
      'revisions_json',
      sql`json_valid(${t.frontmatter}) AND json_valid(${t.document}) AND json_valid(${t.verdict}) AND (${t.actorMeta} IS NULL OR json_valid(${t.actorMeta}))`,
    ),
    check('revisions_word_count', sql`${t.wordCount} >= 0`),
  ],
)

/** The tags of a revision, for listing published entries by tag. Append-only, like revisions. */
export const revisionTags = sqliteTable(
  'revision_tags',
  {
    id: id('tag'),
    siteId: siteId(),
    revisionId: text('revision_id').notNull(),
    tag: text('tag').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('revision_tags_id_site').on(t.id, t.siteId),
    unique('revision_tags_tag').on(t.revisionId, t.tag),
    index('revision_tags_by_tag').on(t.siteId, t.tag),
    foreignKey({ name: 'revision_tags_site', columns: [t.siteId], foreignColumns: [sites.id] }),
    foreignKey({
      name: 'revision_tags_revision',
      columns: [t.revisionId, t.siteId],
      foreignColumns: [revisions.id, revisions.siteId],
    }),
  ],
)

/**
 * Every publish and unpublish, appended: the verdict of the publish phase and the warnings the
 * caller acknowledged (ADR-021).
 */
export const publications = sqliteTable(
  'publications',
  {
    id: id('pub'),
    siteId: siteId(),
    entryId: text('entry_id').notNull(),
    action: text('action').notNull(),
    revisionId: text('revision_id'),
    verdict: text('verdict'),
    /** A JSON array: the warnings the caller acknowledged to publish. */
    acknowledged: text('acknowledged').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorUserId: text('actor_user_id').notNull(),
    actorTokenId: text('actor_token_id'),
    actorMeta: text('actor_meta'),
    ...timestamps(),
  },
  (t) => [
    unique('publications_id_site').on(t.id, t.siteId),
    index('publications_entry').on(t.entryId, t.createdAt),
    foreignKey({ name: 'publications_site', columns: [t.siteId], foreignColumns: [sites.id] }),
    foreignKey({
      name: 'publications_entry',
      columns: [t.entryId, t.siteId],
      foreignColumns: [entries.id, entries.siteId],
    }),
    foreignKey({
      name: 'publications_revision',
      columns: [t.revisionId, t.siteId],
      foreignColumns: [revisions.id, revisions.siteId],
    }),
    foreignKey({
      name: 'publications_user',
      columns: [t.actorUserId],
      foreignColumns: [users.id],
    }),
    foreignKey({
      name: 'publications_token',
      columns: [t.actorTokenId, t.siteId],
      foreignColumns: [tokens.id, tokens.siteId],
    }),
    check('publications_action', sql`${t.action} IN ('publish', 'unpublish')`),
    check(
      'publications_shape',
      sql`(${t.action} = 'publish' AND ${t.revisionId} IS NOT NULL AND ${t.verdict} IS NOT NULL) OR (${t.action} = 'unpublish' AND ${t.revisionId} IS NULL AND ${t.verdict} IS NULL)`,
    ),
    check('publications_actor_kind', sql`${t.actorKind} IN ('token', 'user', 'oauth_client')`),
    check(
      'publications_json',
      sql`json_valid(${t.acknowledged}) AND json_type(${t.acknowledged}) = 'array' AND (${t.verdict} IS NULL OR json_valid(${t.verdict})) AND (${t.actorMeta} IS NULL OR json_valid(${t.actorMeta}))`,
    ),
  ],
)
