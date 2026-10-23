import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod'

import {
  describeShape,
  isDateSchema,
  isStringArraySchema,
  isStringSchema,
  resolveSchema,
  toJsonSchema,
} from '../../src/config/json-schema.ts'
import type { DescribedSchema } from '../../src/config/types.ts'
import { brokenSchema, schemaOf, thrownBy } from './support.ts'

describe('toJsonSchema', () => {
  it('asks the library for the input JSON Schema of draft 2020-12', () => {
    const asked: unknown[] = []
    const schema: DescribedSchema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => ({ value }),
        jsonSchema: {
          input: (options) => {
            asked.push(options)
            return { type: 'object', title: 'input' }
          },
          output: () => ({ type: 'object', title: 'output' }),
        },
      },
    }
    expect(toJsonSchema(schema)).toEqual({ type: 'object', title: 'input' })
    expect(asked).toEqual([{ target: 'draft-2020-12' }])
  })

  it('writes the input side of Zod: an object that does not say it rejects unknown keys', () => {
    expect(toJsonSchema(z.object({ id: z.string() }))).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    })
    expect(toJsonSchema(z.strictObject({ id: z.string() }))).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    })
  })

  it('returns plain JSON of its own, never the object of the library nor its hidden keys', () => {
    const library = { type: 'object' }
    Object.defineProperty(library, '~standard', { value: { vendor: 'hidden' }, enumerable: false })
    const copy = toJsonSchema(schemaOf(library))
    expect(copy).toEqual({ type: 'object' })
    expect(copy).not.toBe(library)
    expect(Reflect.ownKeys(copy)).toEqual(['type'])
    expect(Reflect.ownKeys(toJsonSchema(z.object({})))).not.toContain('~standard')
  })

  it('refuses a library whose converter answers with something that is no object', () => {
    const answers = [
      [null, 'the library is null; it must be a JSON Schema object'],
      ['object', 'the library is "object"; it must be a JSON Schema object'],
      [undefined, 'the library is missing; it must be a JSON Schema object'],
      [[], 'the library is an array; it must be a JSON Schema object'],
    ] as const
    for (const [answer, message] of answers) {
      const thrown = thrownBy(() => toJsonSchema(brokenSchema(answer)))
      expect(thrown).toBeInstanceOf(TypeError)
      expect(thrown instanceof Error ? thrown.message : thrown).toBe(message)
    }
  })

  it('lets what the library throws through', () => {
    expect(thrownBy(() => toJsonSchema(z.date()))).toBeInstanceOf(Error)
    expect(thrownBy(() => toJsonSchema(z.object({ at: z.date() })))).toBeInstanceOf(Error)
  })
})

describe('resolveSchema', () => {
  const string = { type: 'string' }
  const root = {
    $defs: {
      Tag: string,
      Alias: { $ref: '#/$defs/Tag' },
      LoopA: { $ref: '#/$defs/LoopB' },
      LoopB: { $ref: '#/$defs/LoopA' },
      'a/b': { type: 'number' },
      'a~b': { type: 'boolean' },
      List: [string],
    },
  }

  it('gives back a schema that has no reference', () => {
    expect(resolveSchema(root, string)).toBe(string)
  })

  it('follows a local reference, and a chain of them', () => {
    expect(resolveSchema(root, { $ref: '#/$defs/Tag' })).toBe(string)
    expect(resolveSchema(root, { $ref: '#/$defs/Alias' })).toBe(string)
  })

  it('follows "#" to the root of the document', () => {
    expect(resolveSchema(root, { $ref: '#' })).toBe(root)
  })

  it('reads the ~1 and ~0 escapes of a JSON Pointer', () => {
    expect(resolveSchema(root, { $ref: '#/$defs/a~1b' })).toEqual({ type: 'number' })
    expect(resolveSchema(root, { $ref: '#/$defs/a~0b' })).toEqual({ type: 'boolean' })
  })

  it('answers null for a reference that goes nowhere, and does not loop on a cycle', () => {
    expect(resolveSchema(root, { $ref: '#/$defs/Missing' })).toBeNull()
    expect(resolveSchema(root, { $ref: '#/$defs/LoopA' })).toBeNull()
    expect(resolveSchema(root, { $ref: '#/$defs/Tag/type' })).toBeNull()
    expect(resolveSchema(root, { $ref: '#/$defs/List/0' })).toBeNull()
    expect(resolveSchema(root, { $ref: 'https://example.com/tag.json' })).toBeNull()
    expect(resolveSchema(root, { $ref: './$defs/Tag' })).toBeNull()
  })

  it('finds only what the document has, not what every object inherits', () => {
    expect(resolveSchema(root, { $ref: '#/__proto__' })).toBeNull()
    expect(resolveSchema(root, { $ref: '#/$defs/constructor' })).toBeNull()
  })

  it('takes a $ref that is no string for part of the schema, not for a reference', () => {
    const odd = { $ref: 7, type: 'string' }
    expect(resolveSchema(root, odd)).toBe(odd)
  })

  it('answers null for what is not a schema object', () => {
    for (const value of [undefined, null, true, 'string', 3, [string]]) {
      expect(resolveSchema(root, value)).toBeNull()
    }
  })
})

describe('what a property is', () => {
  const root = {
    $defs: {
      Tag: { type: 'string' },
      Day: { type: 'string', format: 'date' },
      Tags: { type: 'array', items: { $ref: '#/$defs/Tag' } },
    },
  }

  type Rows = readonly (readonly [unknown, boolean])[]
  const answers = (
    check: (root: Record<string, unknown>, property: unknown) => boolean,
    rows: Rows,
  ) => rows.map(([property]) => check(root, property))
  const expected = (rows: Rows) => rows.map(([, accepted]) => accepted)

  it('is a string only when its type is string', () => {
    const rows: Rows = [
      [{ type: 'string' }, true],
      [{ type: 'string', enum: ['a', 'b'] }, true],
      [{ $ref: '#/$defs/Tag' }, true],
      [{ type: 'number' }, false],
      [{ type: ['string', 'null'] }, false],
      [{ anyOf: [{ type: 'string' }, { type: 'null' }] }, false],
      [{ enum: ['a', 'b'] }, false],
      [{}, false],
      [{ $ref: '#/$defs/Missing' }, false],
      [true, false],
    ]
    expect(answers(isStringSchema, rows)).toEqual(expected(rows))
  })

  it('is an array of strings only when its items are strings', () => {
    const rows: Rows = [
      [{ type: 'array', items: { type: 'string' } }, true],
      [{ type: 'array', items: { type: 'string', enum: ['a'] }, minItems: 1 }, true],
      [{ $ref: '#/$defs/Tags' }, true],
      [{ type: 'array', items: { type: 'number' } }, false],
      [{ type: 'array', items: { type: 'array', items: { type: 'string' } } }, false],
      [{ type: 'array' }, false],
      [{ type: 'array', prefixItems: [{ type: 'string' }], items: false }, false],
      [{ type: 'string' }, false],
      [{ anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }] }, false],
    ]
    expect(answers(isStringArraySchema, rows)).toEqual(expected(rows))
  })

  it('is a date only when it is a string with the date or date-time format', () => {
    const rows: Rows = [
      [{ type: 'string', format: 'date' }, true],
      [{ type: 'string', format: 'date-time' }, true],
      [{ $ref: '#/$defs/Day' }, true],
      [{ type: 'string' }, false],
      [{ type: 'string', format: 'email' }, false],
      [{ type: 'string', format: 'time' }, false],
      [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, false],
      [{ type: 'number', format: 'date' }, false],
      [{ format: 'date' }, false],
      [{ type: ['string', 'null'], format: 'date' }, false],
    ]
    expect(answers(isDateSchema, rows)).toEqual(expected(rows))
  })

  it('is what Zod writes for the schemas a config uses', () => {
    const json = toJsonSchema(
      z.object({
        title: z.string(),
        tags: z.array(z.string()),
        day: z.iso.date(),
        moment: z.iso.datetime(),
        views: z.number(),
        maybe: z.string().nullable(),
      }),
    )
    const properties = json['properties']
    if (typeof properties !== 'object' || properties === null) throw new Error('no properties')
    const of = (name: string) => Reflect.get(properties, name)
    expect({
      title: isStringSchema(json, of('title')),
      tags: isStringArraySchema(json, of('tags')),
      day: isDateSchema(json, of('day')),
      moment: isDateSchema(json, of('moment')),
      views: isStringSchema(json, of('views')),
      maybe: isStringSchema(json, of('maybe')),
    }).toEqual({ title: true, tags: true, day: true, moment: true, views: false, maybe: false })
  })
})

describe('describeShape', () => {
  const root = {
    $defs: {
      Tag: { type: 'string' },
      Tags: { type: 'array', items: { $ref: '#/$defs/Tag' } },
    },
  }

  it('names the type of a schema in the words of a message', () => {
    const shapes: readonly [unknown, string][] = [
      [{ type: 'string' }, 'string'],
      [{ type: 'integer' }, 'integer'],
      [{ type: ['string', 'null'] }, 'string or null'],
      [{ type: [1, 2] }, 'any value'],
      [{ anyOf: [{ type: 'string' }, { type: 'null' }] }, 'a union'],
      [{ oneOf: [{ type: 'string' }] }, 'a union'],
      [{}, 'any value'],
      [{ type: 'array', items: { type: 'number' } }, 'an array of number'],
      [{ type: 'array' }, 'an array of any value'],
      [{ type: 'array', items: { type: 'array' } }, 'an array of array'],
      [{ type: 'array', items: { $ref: '#/$defs/Tag' } }, 'an array of string'],
      [{ $ref: '#/$defs/Tags' }, 'an array of string'],
      [{ $ref: '#/$defs/Missing' }, 'an unresolvable reference'],
    ]
    expect(shapes.map(([schema]) => describeShape(root, schema))).toEqual(
      shapes.map(([, shape]) => shape),
    )
  })
})
