import type { Problems } from './config-error.ts'
import { describeShape, resolveSchema } from './json-schema.ts'
import { isRecord, keyPath, type JsonObject, wrongType } from './values.ts'

/**
 * The fields of a frontmatter that Hollware fills itself, so that nobody writes them by hand: the
 * dates a reader sees and the length of an entry. A collection names them in `automaticFields`.
 * They are filled where a site reads (RPC, the read API, `hollware export --published`), never
 * in the Markdown that was written, which stays byte for byte what its author sent (ADR-001).
 *
 * - `firstPublished`: the date the entry was first published. A date written in the Markdown
 *   wins, so content moved from elsewhere keeps its history.
 * - `lastModified`: the date of the revision read, when it was written after the entry was first
 *   published; a later date written in the Markdown wins. Nothing before the first change.
 * - `readingTime`: minutes, at 200 words a minute, at least one.
 * - `wordCount`: the words of the body.
 */
export const AUTOMATIC_KINDS = [
  'firstPublished',
  'lastModified',
  'readingTime',
  'wordCount',
] as const
export type AutomaticKind = (typeof AUTOMATIC_KINDS)[number]

/** What a reading time counts: 200 words a minute. */
export const WORDS_PER_MINUTE = 200

/** A field Hollware fills, and the shape its schema gives the value. */
export interface AutomaticField {
  readonly kind: AutomaticKind
  readonly format: 'date' | 'date-time' | 'number'
}

const DATES: readonly AutomaticKind[] = ['firstPublished', 'lastModified']

function isAutomaticKind(value: unknown): value is AutomaticKind {
  return AUTOMATIC_KINDS.some((kind) => kind === value)
}

/** The fields a collection names, each checked against its schema: a date for a date, a number for a count. */
export function readAutomaticFields(
  path: string,
  raw: unknown,
  schema: { readonly document: JsonObject; readonly object: JsonObject } | null,
  problems: Problems,
): Readonly<Record<string, AutomaticField>> {
  if (raw === undefined || raw === null) return {}
  if (!isRecord(raw)) {
    problems.add(
      path,
      wrongType(raw, 'an object of fields'),
      'Name each field Hollware fills and how: { "dateModified": "lastModified" }.',
    )
    return {}
  }
  const fields: Record<string, AutomaticField> = {}
  const properties =
    schema !== null && isRecord(schema.object['properties']) ? schema.object['properties'] : {}
  for (const [field, kind] of Object.entries(raw)) {
    const at = keyPath(path, field)
    if (!isAutomaticKind(kind)) {
      problems.add(
        at,
        wrongType(kind, AUTOMATIC_KINDS.map((one) => `"${one}"`).join(', ')),
        `Use one of ${AUTOMATIC_KINDS.join(', ')}.`,
      )
      continue
    }
    if (schema === null) continue
    if (!Object.hasOwn(properties, field)) {
      problems.add(
        at,
        `"${field}" is not a property of the schema`,
        `Add "${field}" to the schema of the frontmatter, or name a field it declares.`,
      )
      continue
    }
    const node = resolveSchema(schema.document, properties[field])
    if (DATES.includes(kind)) {
      const format = node?.['type'] === 'string' ? node['format'] : undefined
      if (format === 'date' || format === 'date-time') fields[field] = { kind, format }
      else {
        problems.add(
          at,
          `"${field}" is declared as ${describeShape(schema.document, properties[field])}, but ${kind} fills a date`,
          `Declare "${field}" as a string with the "date" or "date-time" format.`,
        )
      }
    } else if (node?.['type'] === 'integer' || node?.['type'] === 'number') {
      fields[field] = { kind, format: 'number' }
    } else {
      problems.add(
        at,
        `"${field}" is declared as ${describeShape(schema.document, properties[field])}, but ${kind} fills a number`,
        `Declare "${field}" as an integer.`,
      )
    }
  }
  return fields
}

/** What the values are made from: the entry and the revision being read. */
export interface AutomaticFacts {
  /** When the entry was first published, or `null`. */
  readonly publishedAt: string | null
  /** When the revision being read was written. */
  readonly revisionCreatedAt: string
  readonly wordCount: number
}

const formatted = (iso: string, format: AutomaticField['format']) =>
  format === 'date' ? iso.slice(0, 10) : iso

/**
 * The frontmatter as a site reads it: the fields Hollware fills, filled. A field it cannot fill
 * yet (an entry never published) keeps what was written, or stays out.
 */
export function withAutomaticFields(
  fields: Readonly<Record<string, AutomaticField>>,
  facts: AutomaticFacts,
  frontmatter: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const filled: Record<string, unknown> = { ...frontmatter }
  for (const [field, { kind, format }] of Object.entries(fields)) {
    const written = frontmatter[field]
    const text = typeof written === 'string' && written !== '' ? written : null
    switch (kind) {
      case 'firstPublished':
        if (text === null && facts.publishedAt !== null) {
          filled[field] = formatted(facts.publishedAt, format)
        }
        break
      case 'lastModified': {
        const changed =
          facts.publishedAt !== null && facts.revisionCreatedAt > facts.publishedAt
            ? formatted(facts.revisionCreatedAt, format)
            : null
        const latest = [text, changed]
          .filter((value) => value !== null)
          .sort()
          .at(-1)
        if (latest !== undefined) filled[field] = latest
        break
      }
      case 'readingTime':
        filled[field] = Math.max(1, Math.ceil(facts.wordCount / WORDS_PER_MINUTE))
        break
      case 'wordCount':
        filled[field] = facts.wordCount
        break
    }
  }
  return filled
}
