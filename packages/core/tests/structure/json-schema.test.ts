import { describe, expect, it } from 'vite-plus/test'
import { describedSchemaOf } from '../../src/structure/json-schema.ts'

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 5 },
    tags: { type: 'array', items: { type: 'string' } },
    date: { type: 'string', format: 'date' },
  },
  required: ['title', 'date'],
  additionalProperties: false,
}

describe('describedSchemaOf', () => {
  const schema = describedSchemaOf(SCHEMA)

  it('reports each failing part at the path of its value', async () => {
    const result = await schema['~standard'].validate({
      title: 'too long',
      tags: ['a', 1],
      extra: true,
    })
    expect(result.issues?.map((issue) => [issue.path, issue.message])).toEqual([
      [['date'], 'Missing required field "date".'],
      [['title'], 'String is too long (8 > 5).'],
      [['tags', '1'], 'Instance type "number" is invalid. Expected "string".'],
      [['extra'], 'Unrecognized key "extra".'],
    ])
  })

  it('accepts a valid value as it is, and shows its JSON Schema', async () => {
    const value = { title: 'Hola', date: '2026-10-16', tags: [] }
    expect(await schema['~standard'].validate(value)).toEqual({ value })
    expect(schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toBe(SCHEMA)
  })

  it('checks formats', async () => {
    const result = await schema['~standard'].validate({ title: 'Hola', date: '16/10/2026' })
    expect(result.issues?.map((issue) => issue.path)).toEqual([['date']])
  })
})
