export function slugify(text: string): string {
  const slug = text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\s-]+/gu, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'section' : slug
}

export class HeadingIds {
  readonly #used = new Set<string>()
  readonly #next = new Map<string, number>()

  next(text: string): string {
    const base = slugify(text)
    let count = this.#next.get(base) ?? 0
    let id = count === 0 ? base : `${base}-${count}`
    while (this.#used.has(id)) {
      count++
      id = `${base}-${count}`
    }
    this.#used.add(id)
    this.#next.set(base, count + 1)
    return id
  }
}
