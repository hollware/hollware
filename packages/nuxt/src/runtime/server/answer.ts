import { HollwareClientError } from '@hollware/client'
import { createError, setResponseHeader, type H3Event } from 'h3'

/**
 * Hollware's answer as the site's own: a `not_found` outcome is a 404, a refusal of the read API
 * keeps its status, and the rest is the answer. Pages revalidate it: it is published content, and
 * a publication purges nothing on the site's side.
 */
export async function answer<Value extends { outcome: string }>(
  event: H3Event,
  read: () => Promise<Value>,
): Promise<Value> {
  let value: Value
  try {
    value = await read()
  } catch (error) {
    if (error instanceof HollwareClientError) {
      throw createError({ statusCode: error.status, statusMessage: error.message })
    }
    throw error
  }
  if (value.outcome === 'not_found') {
    throw createError({ statusCode: 404, statusMessage: 'Not found in Hollware' })
  }
  setResponseHeader(event, 'cache-control', 'no-cache')
  return value
}

/** The fields of an entry that a page shows: what a reader sees, and not how it was checked. */
const PUBLIC_FIELDS = [
  'id',
  'collection',
  'locale',
  'slug',
  'translationGroup',
  'frontmatter',
  'tags',
  'publishedAt',
  'updatedAt',
  'document',
  // The size, alt and srcset of the images of the frontmatter, for <HollwareImage>.
  'images',
] as const

/**
 * An entry for a page: its verdict, its revision and its last publication stay on the server, as
 * the page sends what it read to the browser in its payload.
 */
export function forPage(entry: unknown): Record<string, unknown> | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  return Object.fromEntries(
    PUBLIC_FIELDS.filter((field) => field in entry).map((field) => [
      field,
      Reflect.get(entry, field),
    ]),
  )
}
