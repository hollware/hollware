/**
 * The first Markdown of a new entry: a frontmatter with every field the collection requires, so
 * that a person starts from what the contracts ask for instead of from their errors. Values are a
 * guess from the field's JSON Schema; the person edits them.
 */

type JsonSchema = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A YAML scalar that reads back as the same string. */
function yamlString(value: string): string {
  return JSON.stringify(value)
}

function valueFor(field: string, schema: JsonSchema, entry: NewEntry): string {
  if (field === 'title') return yamlString(entry.title)
  if (field === entry.translationGroupField)
    return entry.translationGroup === undefined ? entry.slug : yamlString(entry.translationGroup)
  if (schema['format'] === 'date') return entry.today
  if (schema['type'] === 'array') return '[]'
  if (schema['type'] === 'boolean') return 'false'
  if (schema['type'] === 'number' || schema['type'] === 'integer') return '0'
  return '""'
}

export interface NewEntry {
  readonly title: string
  readonly slug: string
  /** The date of today, as YYYY-MM-DD. */
  readonly today: string
  readonly translationGroupField: string | null
  /** The group of the entry this one translates; a new group, the slug, when not given. */
  readonly translationGroup?: string
}

export function newEntryMarkdown(collectionSchema: JsonSchema, entry: NewEntry): string {
  const properties = isRecord(collectionSchema['properties']) ? collectionSchema['properties'] : {}
  const required = Array.isArray(collectionSchema['required'])
    ? collectionSchema['required'].filter((name): name is string => typeof name === 'string')
    : []
  const group = entry.translationGroupField
  const fields = [
    'title',
    ...required.filter((name) => name !== 'title'),
    // A translation names its group even where the schema does not require it.
    ...(group !== null && entry.translationGroup !== undefined && !required.includes(group)
      ? [group]
      : []),
  ]
  const lines = fields.map((field) => {
    const schema = properties[field]
    return `${field}: ${valueFor(field, isRecord(schema) ? schema : {}, entry)}`
  })
  return `---\n${lines.join('\n')}\n---\n\n`
}
