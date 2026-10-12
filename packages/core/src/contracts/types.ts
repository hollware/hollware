import type { ProcessedMarkdown } from '../markdown/types.ts'

/**
 * The shapes of the contracts (ADR-004): what a contract looks at, what it reports, and the
 * verdict of a revision. Contract errors never block a draft; they block publishing.
 */

export type Severity = 'error' | 'warning'

/**
 * When contracts run. `write`: on every `create_draft` and `update_draft`. `publish`: on
 * `validate` and `publish`, where the rules that depend on other entries (links, translation
 * pairs) are checked against the site as it is at that moment.
 */
export type Phase = 'write' | 'publish'

/** One problem a contract found. */
export interface Violation {
  /** The id of the contract: `schema`, `translation-pair`, `seo-title-length`… */
  readonly contract: string
  readonly severity: Severity
  /**
   * A JSON Pointer into the entry seen as `{ frontmatter, body }`: `/frontmatter/description`,
   * or `/body` for the Markdown body (with `line`).
   */
  readonly path: string
  /** What is wrong, for the agent. */
  readonly message: string
  /** What to change so that the problem goes away, for the agent. Never empty. */
  readonly fix: string
  /** The line of the Markdown file, from 1, when the problem has one. */
  readonly line?: number
}

/** The result of running the contracts of a collection on one revision. */
export interface Verdict {
  /** No errors; warnings do not count. */
  readonly ok: boolean
  readonly phase: Phase
  readonly errors: readonly Violation[]
  readonly warnings: readonly Violation[]
  /**
   * A hash of what the revision was checked against: the collection's schema, its components
   * and the ids, severities and phases of its contracts. A stored verdict says which rules it
   * answered to.
   */
  readonly contractsHash: string
}

/** A warning the caller acknowledged to publish, as `publish` takes and `publications` records. */
export interface AcknowledgedWarning {
  readonly contract: string
  readonly path: string
}

/** An entry of the site, by its natural key. */
export interface EntryRef {
  readonly collection: string
  readonly locale: string
  readonly slug: string
}

/** What a lookup tells about an entry. */
export interface EntryFacts {
  readonly id: string
  readonly status: 'draft' | 'scheduled' | 'published'
  readonly translationGroup: string | null
}

/**
 * How contracts read the other entries of the same site. The server implements it on D1, in
 * chunks that stay under D1's 100 bound parameters per statement.
 */
export interface EntryLookup {
  /** The entry for each ref, in the order of `refs`; `null` where there is none. */
  lookupMany(refs: readonly EntryRef[]): Promise<readonly (EntryFacts | null)[]>
  /** Every entry of a translation group of a collection, one per locale. */
  translations(
    collection: string,
    translationGroup: string,
  ): Promise<readonly (EntryRef & EntryFacts)[]>
}

/** What a contract looks at. */
export interface ContractContext<Frontmatter = Record<string, unknown>> {
  readonly site: string
  readonly collection: string
  readonly locale: string
  readonly slug: string
  /** The entry's id, or `null` while the entry is being created. */
  readonly entryId: string | null
  readonly phase: Phase
  /**
   * The frontmatter as the collection's schema returned it. A contract runs only when the
   * schema accepted the frontmatter; otherwise the schema's own violations stand alone.
   */
  readonly frontmatter: Frontmatter
  /** What the Markdown pipeline made of the file. */
  readonly markdown: ProcessedMarkdown
  /** The other entries of the site. */
  readonly entries: EntryLookup
}

/** A problem a contract reports; Hollware adds the contract's id and severity. */
export interface ContractFinding {
  readonly path: string
  readonly message: string
  readonly fix: string
  readonly line?: number
}

/** A rule with an id, a severity and a fix for every problem it finds (ADR-004). */
export interface Contract<Frontmatter = Record<string, unknown>> {
  /** Lowercase words joined by hyphens, unique within the collection: `seo-title-length`. */
  readonly id: string
  readonly severity: Severity
  /** The phases it runs in; both when absent. A rule that reads other entries runs on `publish`. */
  readonly phases?: readonly Phase[]
  /** What the rule asks for, as `describe_site` shows it to agents. */
  readonly description: string
  /** The problems it finds; an empty list passes. */
  check(
    context: ContractContext<Frontmatter>,
  ): readonly ContractFinding[] | Promise<readonly ContractFinding[]>
}
