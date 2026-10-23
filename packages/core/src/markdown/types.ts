import type { MarkdownDocument } from 'comark'
import type { Violation } from '../contracts/types.ts'

/**
 * The Comark document of a revision, as Hollware stores it and hands it to sites: a site renders
 * it with the Comark renderer of its framework, without parsing anything.
 */
export type EntryDocument = MarkdownDocument

export interface Heading {
  readonly depth: 1 | 2 | 3 | 4 | 5 | 6
  readonly text: string
  /** Hollware's own heading id, which keeps letters outside ASCII. */
  readonly id: string
  readonly line?: number
}

/** The entry an internal link names. */
export interface LinkTarget {
  readonly collection: string
  readonly locale: string
  readonly slug: string
}

/**
 * A link of the body, by where it points:
 * - `internal`: a path that matches a route of a collection of the site, so it names an entry;
 * - `site`: any other path of the site, such as `/about/`;
 * - `anchor`: `#section`, within the same entry;
 * - `external`: an `http:`, `https:` or `mailto:` URL.
 *
 * A URL with any other scheme, such as `javascript:`, is no link: it is reported in `disallowed`.
 */
export interface LinkRef {
  readonly href: string
  readonly kind: 'internal' | 'site' | 'anchor' | 'external'
  /** For an `internal` link, the entry it names. */
  readonly target?: LinkTarget
  readonly line?: number
}

export interface ImageRef {
  readonly src: string
  /** The alternative text; `''` when it is missing or empty, which Comark does not tell apart. */
  readonly alt: string
  readonly line?: number
}

/** A component the body uses, with the props it was given. */
export interface ComponentUse {
  readonly name: string
  readonly props: Readonly<Record<string, unknown>>
  readonly line?: number
}

/**
 * Something the pipeline did not let through: the parser leaves a marker in its place, and the
 * content-safety contracts report it. Nothing is dropped silently.
 */
export interface DisallowedMarker {
  readonly kind: 'raw-html' | 'unknown-component' | 'disallowed-attribute' | 'unsafe-url'
  /** The tag, component, attribute or URL. */
  readonly name: string
  readonly line?: number
}

/** What the pipeline finds in the body, for the contracts and the derived columns. */
export interface ExtractedContent {
  readonly headings: readonly Heading[]
  readonly links: readonly LinkRef[]
  readonly images: readonly ImageRef[]
  readonly components: readonly ComponentUse[]
  /** The words of the body, which `word_count` stores. */
  readonly words: number
  /** The words of its code blocks, apart from `words`, which `code_words` stores. */
  readonly codeWords: number
  readonly disallowed: readonly DisallowedMarker[]
}

/** A Markdown file the pipeline could parse. */
export interface ProcessedMarkdown {
  /** The frontmatter as YAML gave it, before the collection's schema looked at it. */
  readonly frontmatter: Readonly<Record<string, unknown>>
  readonly document: EntryDocument
  readonly extracted: ExtractedContent
  /** The version of Comark that parsed it, stored as `comark_version`. */
  readonly comarkVersion: string
  /**
   * The version of Hollware's pipeline settings (plugins, allowlists, heading ids), stored as
   * `pipeline_version`. It changes whenever the same Markdown would give another document.
   */
  readonly pipelineVersion: string
}

export interface ProcessMarkdownOptions {
  /** The components the collection allows; the pipeline marks any other. */
  readonly components: readonly string[]
  /** The largest file accepted, in UTF-8 bytes. */
  readonly maxMarkdownBytes: number
  /** The routes of the site's collections, by collection and then by locale, to find internal links. */
  readonly routes: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/**
 * The pipeline's answer. A file it cannot store, because it is too large or its frontmatter or
 * syntax does not parse, comes back as violations (`size-limit`, `frontmatter-syntax`,
 * `comark-parse`), which make the write `refused`.
 */
export type ProcessResult =
  | { readonly ok: true; readonly value: ProcessedMarkdown }
  | { readonly ok: false; readonly violations: readonly Violation[] }

/** Processes a Markdown file. It answers for any string and never throws. */
export type ProcessMarkdown = (
  markdown: string,
  options: ProcessMarkdownOptions,
) => Promise<ProcessResult>

/** Renders a stored document to HTML that holds no raw HTML. */
export type RenderHtml = (document: EntryDocument) => Promise<string>
