import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
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

/**
 * The sites of the deployment, and their structure (ADR-033). The id is the site's key. Its
 * definition is the JSON that `siteDefinitionData` of `@hollware/core` checks, and `version` moves
 * with every change of it, which is what a Worker compares to know its copy is current. A row
 * without a definition is a site the deployment does not serve yet: the CLI made it before its
 * owner gave it one, or a 0.x deployment has not moved its config. A site in the trash has
 * `deleted_at`, and is served no more. The columns came by `ADD COLUMN`, with no CHECK: a CHECK
 * on them would rebuild the table, which D1 refuses while other tables point at it; the store
 * writes only definitions it has checked.
 */
export const sites = sqliteTable('sites', {
  id: text('id').primaryKey(),
  definition: text('definition'),
  version: integer('version').notNull().default(0),
  deletedAt: text('deleted_at'),
  ...timestamps(),
})

/**
 * People. A user belongs to the deployment; what they may do in a site is their row of `members`.
 *
 * `role` is the role of v0.1 and v0.2, kept with its CHECK of then: SQLite changes a CHECK only by
 * rebuilding the table, and D1, which never turns foreign keys off, refuses to drop a table that
 * other rows point at. Nothing reads it since v0.3. A new user gets the old name of their role
 * (`legacyRoleOf`), so that the column stays true to the CHECK.
 */
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

/** What a person may do in a site (ADR-026): one role per person and site. */
export const members = sqliteTable(
  'members',
  {
    id: id('mbr'),
    siteId: siteId(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('members_id_site').on(t.id, t.siteId),
    unique('members_person').on(t.siteId, t.userId),
    foreignKey({ name: 'members_site', columns: [t.siteId], foreignColumns: [sites.id] }),
    foreignKey({ name: 'members_user', columns: [t.userId], foreignColumns: [users.id] }),
    check('members_role', sql`${t.role} IN ('owner', 'editor', 'author')`),
  ],
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
    /**
     * `personal` (`hw_pat_`) or `read` (`hw_read_`), which reads the published content of the
     * site over the read API and nothing else. Its CHECK is the column's own (migration 0007).
     */
    kind: text('kind', { enum: ['personal', 'read'] })
      .notNull()
      .default('personal'),
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
    /**
     * When the entry went to the trash, or null. A trashed entry keeps its row, its slug and its
     * translation group: only a draft goes there, and it comes back as the draft it was.
     */
    deletedAt: text('deleted_at'),
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

/**
 * Scheduled publications (ADR-025): one per entry at most. The cron trigger publishes the entry when
 * `scheduled_at` has passed, if it is still at `version`, with the warnings that were acknowledged
 * when it was scheduled, and in the name of who scheduled it.
 */
export const schedules = sqliteTable(
  'schedules',
  {
    id: id('sch'),
    siteId: siteId(),
    entryId: text('entry_id').notNull(),
    scheduledAt: text('scheduled_at').notNull(),
    /** The version of the entry once scheduled: a later change cancels the schedule. */
    version: integer('version').notNull(),
    /** A JSON array: the warnings acknowledged when the publication was scheduled. */
    acknowledged: text('acknowledged').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorUserId: text('actor_user_id').notNull(),
    actorTokenId: text('actor_token_id'),
    actorMeta: text('actor_meta'),
    ...timestamps(),
  },
  (t) => [
    unique('schedules_id_site').on(t.id, t.siteId),
    unique('schedules_entry').on(t.siteId, t.entryId),
    index('schedules_due').on(t.scheduledAt),
    foreignKey({ name: 'schedules_site', columns: [t.siteId], foreignColumns: [sites.id] }),
    foreignKey({
      name: 'schedules_entry_fk',
      columns: [t.entryId, t.siteId],
      foreignColumns: [entries.id, entries.siteId],
    }),
    foreignKey({ name: 'schedules_user', columns: [t.actorUserId], foreignColumns: [users.id] }),
    foreignKey({
      name: 'schedules_token',
      columns: [t.actorTokenId, t.siteId],
      foreignColumns: [tokens.id, tokens.siteId],
    }),
    check('schedules_actor_kind', sql`${t.actorKind} IN ('token', 'user', 'oauth_client')`),
    check(
      'schedules_json',
      sql`json_valid(${t.acknowledged}) AND json_type(${t.acknowledged}) = 'array' AND (${t.actorMeta} IS NULL OR json_valid(${t.actorMeta}))`,
    ),
  ],
)

/**
 * The effects of a publication (ADR-025), written in the batch that publishes or unpublishes: one
 * row per event. The Queue consumer delivers each event to every subscriber, and records it in
 * `deliveries`; `sent_at` says that the event was put on the Queue. A change of the structure of
 * the site (ADR-033) is an event too, `site.changed`, about no entry.
 */
export const outbox = sqliteTable(
  'outbox',
  {
    id: id('evt'),
    siteId: siteId(),
    /** `entry.published`, `entry.unpublished`, or `site.changed`. */
    kind: text('kind').notNull(),
    /** The entry of an event about one, and none for `site.changed`. */
    entryId: text('entry_id'),
    /** A JSON object: what subscribers get. */
    payload: text('payload').notNull(),
    sentAt: text('sent_at'),
    ...timestamps(),
  },
  (t) => [
    unique('outbox_id_site').on(t.id, t.siteId),
    index('outbox_unsent').on(t.sentAt, t.createdAt),
    foreignKey({ name: 'outbox_site', columns: [t.siteId], foreignColumns: [sites.id] }),
    check(
      'outbox_kind',
      sql`${t.kind} IN ('entry.published', 'entry.unpublished', 'site.changed')`,
    ),
    check('outbox_entry', sql`(${t.kind} = 'site.changed') = (${t.entryId} IS NULL)`),
    check('outbox_json', sql`json_valid(${t.payload}) AND json_type(${t.payload}) = 'object'`),
  ],
)

/** Each delivery of an event to a subscriber, so that a retry never delivers it twice. */
export const deliveries = sqliteTable(
  'deliveries',
  {
    id: id('dlv'),
    siteId: siteId(),
    eventId: text('event_id').notNull(),
    /** The subscriber, by its name in the config, such as `webhook:newsletter` or `indexnow`. */
    subscriber: text('subscriber').notNull(),
    attempts: integer('attempts').notNull(),
    deliveredAt: text('delivered_at'),
    lastError: text('last_error'),
    ...timestamps(),
  },
  (t) => [
    unique('deliveries_id_site').on(t.id, t.siteId),
    unique('deliveries_event_subscriber').on(t.eventId, t.subscriber),
    foreignKey({ name: 'deliveries_site', columns: [t.siteId], foreignColumns: [sites.id] }),
    foreignKey({
      name: 'deliveries_event',
      columns: [t.eventId, t.siteId],
      foreignColumns: [outbox.id, outbox.siteId],
    }),
    check('deliveries_attempts', sql`${t.attempts} >= 0`),
  ],
)

/**
 * The passkeys of a person (ADR-026): WebAuthn credentials, by their id, with their public key. A
 * person is one across the sites of a deployment (v0.4), and so are their passkeys and sessions.
 */
export const passkeys = sqliteTable(
  'passkeys',
  {
    id: id('pky'),
    userId: text('user_id').notNull(),
    /** The credential id, base64url, as the authenticator gives it. */
    credentialId: text('credential_id').notNull(),
    /** The COSE public key, base64url. */
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull(),
    /** A JSON array of the transports the authenticator reported. */
    transports: text('transports').notNull(),
    /** What the person calls it, such as "MacBook". */
    label: text('label').notNull(),
    lastUsedAt: text('last_used_at'),
    ...timestamps(),
  },
  (t) => [
    unique('passkeys_credential').on(t.credentialId),
    index('passkeys_user').on(t.userId),
    foreignKey({ name: 'passkeys_user_fk', columns: [t.userId], foreignColumns: [users.id] }),
    check('passkeys_counter', sql`${t.counter} >= 0`),
    check(
      'passkeys_json',
      sql`json_valid(${t.transports}) AND json_type(${t.transports}) = 'array'`,
    ),
  ],
)

/**
 * Links that let a person in, once: the owner's setup link that `hollware init` prints (it names
 * the owner) and invitations (they carry a role, and the person they make is new). Only the hash
 * of the link's secret is stored.
 */
export const invitations = sqliteTable(
  'invitations',
  {
    id: id('inv'),
    siteId: siteId(),
    hash: text('hash').notNull(),
    role: text('role').notNull(),
    /** The existing person the link is for, or null for an invitation that makes a new one. */
    userId: text('user_id'),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
    ...timestamps(),
  },
  (t) => [
    unique('invitations_id_site').on(t.id, t.siteId),
    unique('invitations_hash').on(t.hash),
    foreignKey({ name: 'invitations_site', columns: [t.siteId], foreignColumns: [sites.id] }),
    foreignKey({ name: 'invitations_user', columns: [t.userId], foreignColumns: [users.id] }),
    check('invitations_role', sql`${t.role} IN ('owner', 'editor', 'author')`),
  ],
)

/** WebAuthn challenges, each used once and briefly (ADR-026). */
export const authChallenges = sqliteTable(
  'auth_challenges',
  {
    id: id('chl'),
    challenge: text('challenge').notNull(),
    /** `register` or `authenticate`. */
    purpose: text('purpose').notNull(),
    /** The invitation a registration redeems, or null for a sign-in. */
    invitationId: text('invitation_id'),
    /** The person a registration makes or adds a passkey to: the id the passkey is bound to. */
    userId: text('user_id'),
    expiresAt: text('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [check('auth_challenges_purpose', sql`${t.purpose} IN ('register', 'authenticate')`)],
)

/** Signed-in people (ADR-026): the session cookie that `/authorize` reads, by its hash. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: id('ses'),
    userId: text('user_id').notNull(),
    hash: text('hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('sessions_hash').on(t.hash),
    foreignKey({ name: 'sessions_user', columns: [t.userId], foreignColumns: [users.id] }),
  ],
)

/**
 * Reviews (v0.3): a person who may write but not publish asks for a revision to be published, and
 * a person who may publish approves it, which publishes it, or asks for changes with a note. An
 * entry has at most one pending review; a new revision of the entry cancels it, and a publication
 * of the entry approves it, in the batch of that write.
 */
export const reviews = sqliteTable(
  'reviews',
  {
    id: id('rvw'),
    siteId: siteId(),
    entryId: text('entry_id').notNull(),
    /** The revision asked for: the head of the entry when the review was asked. */
    revisionId: text('revision_id').notNull(),
    status: text('status').notNull(),
    /** A JSON array: the warnings the person who asked acknowledged. */
    acknowledged: text('acknowledged').notNull(),
    requestedBy: text('requested_by').notNull(),
    /** What the client that asked said about itself, as JSON, or `null`. */
    requestedMeta: text('requested_meta'),
    decidedBy: text('decided_by'),
    decidedAt: text('decided_at'),
    /** What the person who asked for changes wrote. */
    note: text('note'),
    ...timestamps(),
  },
  (t) => [
    unique('reviews_id_site').on(t.id, t.siteId),
    uniqueIndex('reviews_pending')
      .on(t.siteId, t.entryId)
      .where(sql`${t.status} = 'pending'`),
    index('reviews_queue').on(t.siteId, t.status, t.createdAt),
    foreignKey({ name: 'reviews_site', columns: [t.siteId], foreignColumns: [sites.id] }),
    foreignKey({
      name: 'reviews_entry',
      columns: [t.entryId, t.siteId],
      foreignColumns: [entries.id, entries.siteId],
    }),
    foreignKey({
      name: 'reviews_revision',
      columns: [t.revisionId, t.siteId],
      foreignColumns: [revisions.id, revisions.siteId],
    }),
    foreignKey({ name: 'reviews_requester', columns: [t.requestedBy], foreignColumns: [users.id] }),
    foreignKey({ name: 'reviews_decider', columns: [t.decidedBy], foreignColumns: [users.id] }),
    check(
      'reviews_status',
      sql`${t.status} IN ('pending', 'approved', 'changes_requested', 'cancelled')`,
    ),
    check(
      'reviews_decided',
      sql`(${t.status} IN ('pending', 'cancelled')) OR (${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL)`,
    ),
    check(
      'reviews_json',
      sql`json_valid(${t.acknowledged}) AND json_type(${t.acknowledged}) = 'array' AND (${t.requestedMeta} IS NULL OR json_valid(${t.requestedMeta}))`,
    ),
  ],
)

/**
 * The vectors of an entry, as derived data (v0.5): the published revision they were made from,
 * with which model and which version of the chunker, and how many pieces there are. The vectors
 * live in Vectorize under `<entry id>:<piece>`; this row says which exist and whether they are
 * current. One row per entry: a new publication replaces it.
 */
export const entryEmbeddings = sqliteTable(
  'entry_embeddings',
  {
    id: id('emb'),
    siteId: siteId(),
    entryId: text('entry_id').notNull(),
    revisionId: text('revision_id').notNull(),
    model: text('model').notNull(),
    chunkerVersion: text('chunker_version').notNull(),
    /** How many pieces, so how many vectors: `<entry id>:0` to `<entry id>:<pieces - 1>`. */
    pieces: integer('pieces').notNull(),
    /**
     * The entries closest to this one by their summaries, in its collection and locale, closest
     * first, as JSON: `[{ "id": "ent_…", "score": 0.91 }]`. Found when its vectors were made.
     */
    related: text('related').notNull().default('[]'),
    ...timestamps(),
  },
  (t) => [
    unique('entry_embeddings_id_site').on(t.id, t.siteId),
    unique('entry_embeddings_entry').on(t.siteId, t.entryId),
    foreignKey({ name: 'entry_embeddings_site', columns: [t.siteId], foreignColumns: [sites.id] }),
    foreignKey({
      name: 'entry_embeddings_entry_fk',
      columns: [t.entryId, t.siteId],
      foreignColumns: [entries.id, entries.siteId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'entry_embeddings_revision_fk',
      columns: [t.revisionId, t.siteId],
      foreignColumns: [revisions.id, revisions.siteId],
    }),
    check('entry_embeddings_pieces', sql`${t.pieces} >= 1`),
  ],
)

/**
 * Comments on a review (v0.6): what a person or an agent says about the revision a review asks
 * for, before someone decides. Only a pending review takes one; they stay after the decision.
 */
/**
 * Every change of a site's structure (ADR-033), appended: the definition before and after, the
 * version it made, and who made it. `before` is null when the site was made; `after` when it was
 * put in the trash. `actor_user_id` is null for the move of a 0.x config, which the deployment
 * makes on its own.
 */
export const siteChanges = sqliteTable(
  'site_changes',
  {
    id: id('sit'),
    siteId: siteId(),
    version: integer('version').notNull(),
    actorUserId: text('actor_user_id'),
    /** What the client that made it said about itself, as JSON, or `null`. */
    actorMeta: text('actor_meta'),
    before: text('before'),
    after: text('after'),
    ...timestamps(),
  },
  (t) => [
    unique('site_changes_id_site').on(t.id, t.siteId),
    unique('site_changes_version').on(t.siteId, t.version),
    foreignKey({ name: 'site_changes_site', columns: [t.siteId], foreignColumns: [sites.id] }),
    foreignKey({ name: 'site_changes_user', columns: [t.actorUserId], foreignColumns: [users.id] }),
    check(
      'site_changes_json',
      sql`(${t.before} IS NULL OR json_valid(${t.before})) AND (${t.after} IS NULL OR json_valid(${t.after})) AND (${t.actorMeta} IS NULL OR json_valid(${t.actorMeta}))`,
    ),
  ],
)

/**
 * The secrets Hollware makes for the structure of a site (ADR-033), such as the key that signs a
 * webhook's deliveries: sealed with AES-GCM under the Worker secret `HOLLWARE_SECRET`, so that the
 * database alone never holds one in clear. One per name and site.
 */
export const siteSecrets = sqliteTable(
  'site_secrets',
  {
    id: id('sec'),
    siteId: siteId(),
    name: text('name').notNull(),
    sealed: text('sealed').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('site_secrets_id_site').on(t.id, t.siteId),
    unique('site_secrets_name').on(t.siteId, t.name),
    foreignKey({ name: 'site_secrets_site', columns: [t.siteId], foreignColumns: [sites.id] }),
  ],
)

export const reviewComments = sqliteTable(
  'review_comments',
  {
    id: id('rvc'),
    siteId: siteId(),
    reviewId: text('review_id').notNull(),
    authorId: text('author_id').notNull(),
    /** What the client that wrote it said about itself, as JSON, or `null`. */
    authorMeta: text('author_meta'),
    body: text('body').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('review_comments_id_site').on(t.id, t.siteId),
    index('review_comments_review').on(t.siteId, t.reviewId, t.createdAt),
    foreignKey({ name: 'review_comments_site', columns: [t.siteId], foreignColumns: [sites.id] }),
    foreignKey({
      name: 'review_comments_review_fk',
      columns: [t.reviewId, t.siteId],
      foreignColumns: [reviews.id, reviews.siteId],
    }),
    foreignKey({
      name: 'review_comments_author',
      columns: [t.authorId],
      foreignColumns: [users.id],
    }),
    check('review_comments_body', sql`length(${t.body}) BETWEEN 1 AND 4000`),
  ],
)
