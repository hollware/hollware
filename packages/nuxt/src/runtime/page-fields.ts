const PUBLIC_FIELDS = [
  'id',
  'collection',
  'locale',
  'slug',
  'parent',
  'slugPath',
  'path',
  'translationGroup',
  'frontmatter',
  'tags',
  'publishedAt',
  'updatedAt',
  'document',
  'images',
] as const

export function forPage(entry: unknown): Record<string, unknown> | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  return Object.fromEntries(
    PUBLIC_FIELDS.filter((field) => field in entry).map((field) => [
      field,
      Reflect.get(entry, field),
    ]),
  )
}
