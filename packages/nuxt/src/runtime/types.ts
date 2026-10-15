/** An entry as a page of the site gets it: what a reader sees, and how to render it. */
export interface PageEntry {
  readonly id: string
  readonly collection: string
  readonly locale: string
  readonly slug: string
  readonly translationGroup: string | null
  readonly frontmatter: Record<string, unknown>
  readonly tags: readonly string[]
  readonly publishedAt: string | null
  readonly updatedAt: string
  /** The Comark document of the entry: only an entry read alone has it. */
  readonly document?: unknown
}
