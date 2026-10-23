import { describe, expect, it } from 'vite-plus/test'
import { en } from '../app/i18n/en.ts'

import {
  automaticChoices,
  automaticOf,
  fieldsFromSchema,
  newField,
  problemsOf,
  schemaFromFields,
} from '../app/lib/schema-builder.ts'

const BLOG = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1 },
    seoTitle: { type: 'string', minLength: 1, maxLength: 60 },
    description: { type: 'string', minLength: 1, maxLength: 160, description: 'The summary.' },
    date: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    tags: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
    section: { type: 'string', enum: ['start', 'guides'] },
    order: { type: 'integer', minimum: 0, maximum: 999 },
    meta: { type: 'object' },
  },
  required: ['title', 'description', 'date', 'tags'],
  additionalProperties: false,
}

describe('fieldsFromSchema', () => {
  it('reads each field with its kind, bounds, choices, description and whether it is required', () => {
    const { fields, rest } = fieldsFromSchema(BLOG)

    expect(
      fields.map((f) => [f.key, f.kind, f.required, f.min, f.max, f.options, f.description]),
    ).toEqual([
      ['title', 'text', true, 1, null, [], ''],
      ['seoTitle', 'text', false, 1, 60, [], ''],
      ['description', 'text', true, 1, 160, [], 'The summary.'],
      ['date', 'date', true, null, null, [], ''],
      ['tags', 'list', true, 1, null, [], ''],
      ['section', 'choice', false, null, null, ['start', 'guides'], ''],
      ['order', 'integer', false, 0, 999, [], ''],
      ['meta', 'other', false, null, null, [], ''],
    ])
    expect(rest).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
    })
  })
})

describe('schemaFromFields', () => {
  it('writes back the same schema when nothing changed', () => {
    expect(schemaFromFields(fieldsFromSchema(BLOG))).toEqual(BLOG)
  })

  it('writes what changed and keeps the rest of the field, and starts a field of another kind over', () => {
    const builder = fieldsFromSchema(BLOG)
    const [title, , , date, tags] = builder.fields
    if (title === undefined || date === undefined || tags === undefined)
      throw new Error('no fields')
    title.max = 70
    date.required = false
    tags.kind = 'text'
    builder.fields.push({ ...newField('subtitle', 'text'), required: true, max: 120 })

    const schema = schemaFromFields(builder)

    expect(schema['properties']).toMatchObject({
      title: { type: 'string', minLength: 1, maxLength: 70 },
      date: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      tags: { type: 'string', minLength: 1 },
      subtitle: { type: 'string', maxLength: 120 },
    })
    expect(schema['required']).toEqual(['title', 'description', 'tags', 'subtitle'])
  })
})

describe('problemsOf', () => {
  it('names a bad name, a repeated one, inverted bounds and an empty choice', () => {
    expect(
      problemsOf(
        [
          { ...newField('1st', 'text') },
          { ...newField('a', 'text'), min: 5, max: 2 },
          newField('a', 'choice'),
        ],
        en.collection.problems,
      ),
    ).toEqual([
      '"1st" is not a field name: letters, digits and _, not starting with a digit.',
      '"a": the least is more than the most.',
      '"a" is there twice.',
      '"a": a choice needs at least one value.',
    ])
  })
})

describe('the fields Hollware fills', () => {
  it('offers dates for a date and counts for a number, and keeps only what still fits', () => {
    const fields = [
      newField('date', 'date'),
      newField('updated', 'datetime'),
      newField('minutes', 'integer'),
      newField('title', 'text'),
    ]

    expect(fields.map((field) => automaticChoices(field.kind))).toEqual([
      ['firstPublished', 'lastModified'],
      ['firstPublished', 'lastModified'],
      ['readingTime', 'wordCount'],
      [],
    ])
    expect(
      automaticOf(fields, {
        date: 'firstPublished',
        updated: 'readingTime',
        minutes: 'wordCount',
        gone: 'lastModified',
      }),
    ).toEqual({ date: 'firstPublished', minutes: 'wordCount' })
  })
})
