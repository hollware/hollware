/**
 * Hollware's own heading ids (ADR-020): Comark's drop every letter outside ASCII, so `Diseño`
 * would become `diseo`. The id is the text in lowercase, with the letters, digits and marks of
 * every script kept, whitespace and hyphens collapsed into one hyphen and anything else removed.
 */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\s-]+/gu, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'section' : slug
}

/** Hands out the ids of one document: the second `Setup` is `setup-1`, the third `setup-2`. */
export class HeadingIds {
  readonly #used = new Set<string>()
  readonly #next = new Map<string, number>()

  /** The id for a heading with this text, different from every id handed out before. */
  next(text: string): string {
    const base = slugify(text)
    let count = this.#next.get(base) ?? 0
    let id = count === 0 ? base : `${base}-${count}`
    // A heading can be called `Setup 1`, so the suffix may already be taken.
    while (this.#used.has(id)) {
      count++
      id = `${base}-${count}`
    }
    this.#used.add(id)
    this.#next.set(base, count + 1)
    return id
  }
}
