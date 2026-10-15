import type {
  AcknowledgedWarning,
  EntryDocument,
  EntryLookup,
  EntryRef,
  Verdict,
} from '@hollware/core'

/**
 * The ports of the operation handlers: what they need from the world, as interfaces. The D1
 * store implements `ContentStore` (`db/`); the handlers (`ops/`) only see this file, so their
 * tests run on fakes. Every method takes the site first and never sees another site's rows.
 */

/** Which revision a read returns: the latest one (MCP) or the published one (RPC). */
export type View = 'head' | 'published'

/** Who wrote a revision or a publication. */
export interface Actor {
  readonly kind: 'token' | 'user' | 'oauth_client'
  readonly userId: string
  readonly tokenId: string | null
  /** What the client said about itself (the MCP client and, when it says, the model). */
  readonly meta: Readonly<Record<string, unknown>> | null
}

/** An entry as the store holds it. */
export interface StoredEntry {
  readonly id: string
  readonly collection: string
  readonly locale: string
  readonly slug: string
  readonly translationGroup: string | null
  readonly status: 'draft' | 'scheduled' | 'published'
  /** Moves on every change of the entry; a write against an older one is a conflict. */
  readonly version: number
  readonly headRevision: string
  readonly publishedRevision: string | null
  /** When the entry was first published; republishing keeps it. */
  readonly publishedAt: string | null
  readonly updatedAt: string
}

/** A revision as the store holds it. */
export interface StoredRevision {
  readonly id: string
  readonly entryId: string
  /** The whole file, frontmatter included: the source of truth (ADR-001). */
  readonly markdown: string
  readonly frontmatter: Readonly<Record<string, unknown>>
  readonly document: EntryDocument
  readonly comarkVersion: string
  readonly pipelineVersion: string
  readonly wordCount: number
  /** The verdict of the `write` phase when the revision was written. */
  readonly verdict: Verdict
  readonly tags: readonly string[]
  readonly actor: Actor
  readonly createdAt: string
}

/** An entry with the revision of the view that was asked for. */
export interface EntryView {
  readonly entry: StoredEntry
  readonly revision: StoredRevision
}

/**
 * What a listing needs of a revision: its frontmatter and tags, never the Markdown or the
 * document, which can weigh megabytes on a page of a hundred entries.
 */
export interface RevisionSummary {
  readonly id: string
  readonly frontmatter: Readonly<Record<string, unknown>>
  readonly tags: readonly string[]
}

/** An entry with the summary of the revision of the view that was asked for. */
export interface EntrySummaryView {
  readonly entry: StoredEntry
  readonly revision: RevisionSummary
}

/** A publish or an unpublish, as `publications` keeps it (ADR-021). */
export interface StoredPublication {
  readonly id: string
  readonly entryId: string
  readonly action: 'publish' | 'unpublish'
  readonly revisionId: string | null
  readonly verdict: Verdict | null
  readonly acknowledged: readonly AcknowledgedWarning[]
  readonly actor: Actor
  readonly createdAt: string
}

/** A revision to append. The store adds its id and time. */
export interface NewRevision {
  readonly markdown: string
  readonly frontmatter: Readonly<Record<string, unknown>>
  readonly document: EntryDocument
  readonly comarkVersion: string
  readonly pipelineVersion: string
  readonly wordCount: number
  readonly verdict: Verdict
  readonly tags: readonly string[]
  readonly actor: Actor
}

export interface ListQuery {
  readonly collection: string
  readonly locale?: string
  readonly tag?: string
  readonly status?: StoredEntry['status']
  readonly view: View
  readonly limit: number
  /** The `nextCursor` of the previous page. */
  readonly cursor?: string
}

/** A full-text search of the published entries of a site. */
export interface SearchQuery {
  /** What the person or the agent typed: its words are matched, its punctuation is not. */
  readonly text: string
  readonly collection?: string
  readonly locale?: string
  readonly limit: number
}

/** An entry that a search found, best first. */
export interface SearchHit {
  readonly entry: EntrySummaryView
  /** The words around the match in the text, the match between `[` and `]`. */
  readonly snippet: string
  /** How well it matches: higher is better. */
  readonly score: number
}

/** An entry close to another by meaning, and how close: higher is closer. */
export interface RelatedEntry {
  readonly id: string
  readonly score: number
}

/** The answer to a write that the store could not make. */
export type WriteRefusal =
  | { readonly outcome: 'conflict'; readonly currentVersion: number; readonly headRevision: string }
  | { readonly outcome: 'not_found' }
  /** Another entry already has this slug, or this translation, in the collection and locale. */
  | { readonly outcome: 'taken'; readonly field: 'slug' | 'translationGroup'; readonly by: string }
  /** The row would be over `MAX_ROW_BYTES` (`limits.ts`); nothing was written. */
  | { readonly outcome: 'too_large'; readonly bytes: number; readonly limit: number }

/** The status of a review (v0.3). */
export type ReviewStatus = 'pending' | 'approved' | 'changes_requested' | 'cancelled'

/** A request to publish a revision, and what was decided about it. */
export interface StoredReview {
  readonly id: string
  readonly entryId: string
  readonly revisionId: string
  readonly status: ReviewStatus
  /** The warnings the person who asked acknowledged. */
  readonly acknowledged: readonly AcknowledgedWarning[]
  readonly requestedBy: string
  /** The name of the user who asked, or `null` when they gave none. */
  readonly requestedByName: string | null
  readonly requestedAt: string
  readonly decidedBy: string | null
  readonly decidedAt: string | null
  readonly note: string | null
}

/** A scheduled publication, as the cron trigger reads it. */
export interface StoredSchedule {
  readonly entryId: string
  readonly scheduledAt: string
  /** The version the entry had once scheduled; another one means it changed since. */
  readonly version: number
  readonly acknowledged: readonly AcknowledgedWarning[]
  readonly actor: Actor
}

/** One entry of a publication: what `publish` and `publishGroup` write for it. */
export interface PublishWrite {
  readonly entryId: string
  readonly expectedVersion: number
  readonly verdict: Verdict
  readonly acknowledged: readonly AcknowledgedWarning[]
  readonly actor: Actor
  /** What orders the entry in published listings. */
  readonly sortKey: string
  /** The event of the publication, written to the outbox in the same batch (ADR-025). */
  readonly event?: OutboxEvent | null
}

/** An event for the outbox: its id and what subscribers get, as JSON. */
export interface OutboxEvent {
  readonly id: string
  readonly payload: string
}

export interface ContentStore {
  /** The entry with that collection, locale and slug, in the given view, or `null`. */
  findEntry(site: string, ref: EntryRef, view: View): Promise<EntryView | null>
  /** The entry with that id, in the given view, or `null`. */
  findEntryById(site: string, id: string, view: View): Promise<EntryView | null>
  /**
   * A page of entries. The `head` view is ordered by the last change, the `published` view by
   * the published sort key, newest first; ties go by id. The cursor is opaque.
   */
  listEntries(
    site: string,
    query: ListQuery,
  ): Promise<{ readonly entries: readonly EntrySummaryView[]; readonly nextCursor: string | null }>
  /**
   * The published entries whose title, tags or text hold every word of the query, best first:
   * the title weighs most, then the tags, then the text (bm25).
   */
  searchEntries(site: string, query: SearchQuery): Promise<readonly SearchHit[]>
  /** The entries of those ids that the view has, in the order of the ids. */
  findSummaries(
    site: string,
    ids: readonly string[],
    view: View,
  ): Promise<readonly EntrySummaryView[]>
  /** The entries closest to one by meaning, closest first (ADR-030); `[]` when it has no vectors. */
  relatedOf(site: string, entryId: string): Promise<readonly RelatedEntry[]>
  /** The entries of a translation group, one per locale, in the given view. */
  listTranslations(
    site: string,
    collection: string,
    translationGroup: string,
    view: View,
  ): Promise<readonly EntrySummaryView[]>
  /** What cross-entry contracts read, scoped to the site. */
  lookup(site: string): EntryLookup
  /** The latest publish or unpublish of an entry, or `null`. */
  lastPublication(site: string, entryId: string): Promise<StoredPublication | null>
  /** Creates an entry at version 1 with its first revision, as a draft. */
  createEntry(
    site: string,
    entry: EntryRef & { readonly translationGroup: string | null; readonly revision: NewRevision },
  ): Promise<{ readonly outcome: 'saved'; readonly view: EntryView } | WriteRefusal>
  /**
   * Appends a revision and makes it the head, if the entry is still at `expectedVersion`. In
   * one batch: the revision, its tags (only where the revision was inserted), the cancellation of
   * a pending review, which asked for another revision, and the entry.
   */
  appendRevision(
    site: string,
    write: {
      readonly entryId: string
      readonly expectedVersion: number
      readonly translationGroup: string | null
      readonly revision: NewRevision
    },
  ): Promise<{ readonly outcome: 'saved'; readonly view: EntryView } | WriteRefusal>
  /**
   * Publishes the head revision, if the entry is still at `expectedVersion`, and appends the
   * publication with its verdict and acknowledged warnings. A pending review of the entry is
   * approved by the actor in the same batch: what it asked for is published.
   */
  publish(
    site: string,
    write: PublishWrite,
  ): Promise<{ readonly outcome: 'published'; readonly view: EntryView } | WriteRefusal>
  /**
   * Publishes the head revisions of a group of entries in one batch, all or none (ADR-024): every
   * entry must still be at its `expectedVersion`. A refusal names the entry that caused it.
   */
  publishGroup(
    site: string,
    writes: readonly PublishWrite[],
  ): Promise<
    | { readonly outcome: 'published'; readonly views: readonly EntryView[] }
    | (WriteRefusal & { readonly entryId: string })
  >
  /**
   * Schedules the publication of an entry that is not published, if it is still at
   * `expectedVersion`: the entry becomes `scheduled` at the next version, and its schedule keeps
   * the acknowledged warnings and the actor for the cron trigger (ADR-025).
   */
  schedule(
    site: string,
    write: {
      readonly entryId: string
      readonly expectedVersion: number
      readonly scheduledAt: string
      readonly acknowledged: readonly AcknowledgedWarning[]
      readonly actor: Actor
    },
  ): Promise<{ readonly outcome: 'scheduled'; readonly view: EntryView } | WriteRefusal>
  /** The schedules whose time has come, at most 50, oldest first. */
  dueSchedules(site: string, now: string): Promise<readonly StoredSchedule[]>
  /** Takes a scheduled entry back to a draft and drops its schedule. */
  cancelSchedule(site: string, entryId: string): Promise<void>
  /**
   * Asks for the head revision of an entry to be published, if the entry is still at
   * `expectedVersion`. An entry has one pending review at most: asking again answers it.
   */
  requestReview(
    site: string,
    write: {
      readonly entryId: string
      readonly expectedVersion: number
      readonly acknowledged: readonly AcknowledgedWarning[]
      readonly actor: Actor
    },
  ): Promise<{ readonly outcome: 'pending_review'; readonly review: StoredReview } | WriteRefusal>
  /** A review of the site, by its id, or `null`. */
  findReview(site: string, id: string): Promise<StoredReview | null>
  /** The reviews of the site with this status, newest first. */
  listReviews(
    site: string,
    query: { readonly status: ReviewStatus; readonly limit: number },
  ): Promise<readonly StoredReview[]>
  /** Closes a pending review with a note, without publishing. */
  requestChanges(
    site: string,
    write: { readonly id: string; readonly note: string; readonly userId: string },
  ): Promise<
    | { readonly outcome: 'changes_requested' | 'not_pending'; readonly review: StoredReview }
    | { readonly outcome: 'not_found' }
  >
  /** Takes the entry off the public site and appends the unpublish. */
  unpublish(
    site: string,
    write: { readonly entryId: string; readonly actor: Actor; readonly event?: OutboxEvent | null },
  ): Promise<{ readonly outcome: 'unpublished'; readonly view: EntryView } | WriteRefusal>
}

/** The time, so that tests can fix it. */
export interface Clock {
  now(): Date
}

/*
 * Semantic search (ADR-030) stands on two services that have no local emulation: a model that
 * turns text into vectors, and an index that finds the nearest ones. Both are ports, so that tests
 * use deterministic fakes and a deployment without them has no semantic search at all.
 */

/** Turns texts into vectors, all of the same length. */
export interface Embedder {
  /** The model, which the stored vectors name: another model makes them stale. */
  readonly model: string
  embed(texts: readonly string[]): Promise<number[][]>
}

/** What a vector says about where it comes from, to filter and to read a match back. */
export interface VectorMetadata {
  readonly site: string
  readonly entry: string
  readonly collection: string
  readonly locale: string
  /** The piece of the entry: 0 for its summary. */
  readonly piece: number
  /** The start of the piece's text, for the snippet of a match. */
  readonly excerpt: string
}

export interface StoredVector {
  /** `<entry id>:<piece>`. */
  readonly id: string
  readonly values: readonly number[]
  readonly metadata: VectorMetadata
}

export interface VectorMatch {
  readonly id: string
  /** How close: higher is closer. */
  readonly score: number
  readonly metadata: VectorMetadata
}

export interface VectorIndex {
  upsert(vectors: readonly StoredVector[]): Promise<void>
  remove(ids: readonly string[]): Promise<void>
  /** The `topK` vectors nearest to `values` among those of the site, narrowed as asked. */
  query(
    values: readonly number[],
    options: {
      readonly topK: number
      readonly site: string
      readonly collection?: string
      readonly locale?: string
      /** Only the summaries, one vector per entry. */
      readonly summariesOnly?: boolean
    },
  ): Promise<readonly VectorMatch[]>
}

/** What semantic search needs: both services, or the deployment has none. */
export interface Semantic {
  readonly embedder: Embedder
  readonly index: VectorIndex
}
