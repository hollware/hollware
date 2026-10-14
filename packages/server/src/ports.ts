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

/** The answer to a write that the store could not make. */
export type WriteRefusal =
  | { readonly outcome: 'conflict'; readonly currentVersion: number; readonly headRevision: string }
  | { readonly outcome: 'not_found' }
  /** Another entry already has this slug, or this translation, in the collection and locale. */
  | { readonly outcome: 'taken'; readonly field: 'slug' | 'translationGroup'; readonly by: string }
  /** The row would be over `MAX_ROW_BYTES` (`limits.ts`); nothing was written. */
  | { readonly outcome: 'too_large'; readonly bytes: number; readonly limit: number }

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
   * one batch: the revision, its tags (only where the revision was inserted) and the entry.
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
   * publication with its verdict and acknowledged warnings.
   */
  publish(
    site: string,
    write: {
      readonly entryId: string
      readonly expectedVersion: number
      readonly verdict: Verdict
      readonly acknowledged: readonly AcknowledgedWarning[]
      readonly actor: Actor
      /** What orders the entry in published listings. */
      readonly sortKey: string
    },
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
  /** Takes the entry off the public site and appends the unpublish. */
  unpublish(
    site: string,
    write: { readonly entryId: string; readonly actor: Actor },
  ): Promise<{ readonly outcome: 'unpublished'; readonly view: EntryView } | WriteRefusal>
}

/** The time, so that tests can fix it. */
export interface Clock {
  now(): Date
}
