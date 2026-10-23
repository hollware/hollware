import { HollwareClientError } from '@hollware/client'
import { createError, setResponseHeader, type H3Event } from 'h3'

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
