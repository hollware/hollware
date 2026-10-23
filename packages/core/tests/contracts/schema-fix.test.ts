import { describe, expect, it } from 'vite-plus/test'

import {
  expectation,
  type FixSubject,
  fixForIssue,
  fragmentAt,
  issueSegments,
  label,
} from '../../src/contracts/schema-fix.ts'
import type { JsonObject } from '../../src/contracts/text.ts'

describe('expectation: what a schema accepts, in words', () => {
  const cases: [string, JsonObject, string | undefined][] = [
    ['a plain string', { type: 'string' }, 'a string'],
    [
      'a string with both bounds',
      { type: 'string', minLength: 1, maxLength: 160 },
      'a string of 1 to 160 characters',
    ],
    [
      'a string with a maximum',
      { type: 'string', maxLength: 60 },
      'a string of at most 60 characters',
    ],
    [
      'a string with a minimum of one',
      { type: 'string', minLength: 1 },
      'a string of at least 1 character',
    ],
    [
      'a string of an exact size',
      { type: 'string', minLength: 11, maxLength: 11 },
      'a string of exactly 11 characters',
    ],
    [
      'a string with a format, which wins over a pattern',
      { type: 'string', format: 'date', pattern: '^\\d{4}$' },
      'a string in the format "date"',
    ],
    [
      'a string with a pattern',
      { type: 'string', pattern: '^[a-z]+$' },
      'a string matching the pattern ^[a-z]+$',
    ],
    ['an enum of strings', { type: 'string', enum: ['a', 'b'] }, 'one of "a", "b"'],
    ['an enum of numbers', { enum: [1, 2] }, 'one of 1, 2'],
    ['a constant', { const: 'x' }, 'exactly "x"'],
    [
      'an integer with both bounds',
      { type: 'integer', minimum: 1, maximum: 10 },
      'an integer that is at least 1 and at most 10',
    ],
    [
      'a number above zero',
      { type: 'number', exclusiveMinimum: 0 },
      'a number that is greater than 0',
    ],
    [
      'a number with a maximum and an exclusive maximum',
      { type: 'number', maximum: 4, exclusiveMaximum: 5 },
      'a number that is at most 4 and less than 5',
    ],
    ['a boolean', { type: 'boolean' }, 'true or false'],
    ['null', { type: 'null' }, 'null'],
    [
      'a nullable string',
      { type: ['string', 'null'], maxLength: 3 },
      'a string of at most 3 characters or null',
    ],
    ['a union', { anyOf: [{ type: 'string' }, { type: 'number' }] }, 'a string or a number'],
    [
      'a union written with oneOf',
      { oneOf: [{ type: 'integer' }, { type: 'null' }] },
      'an integer or null',
    ],
    [
      'an array with a minimum and typed items',
      { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
      'an array of at least 1 item, each a string of at least 1 character',
    ],
    [
      'an array of 1 to 3 items',
      { type: 'array', minItems: 1, maxItems: 3 },
      'an array of 1 to 3 items',
    ],
    ['an array of any items', { type: 'array' }, 'an array'],
    [
      'an object with keys',
      { type: 'object', properties: { a: {}, b: {} } },
      'an object with the keys a, b',
    ],
    ['an object without keys', { type: 'object' }, 'an object'],
    ['anything', {}, undefined],
    ['a reference', { $ref: '#/$defs/x' }, undefined],
    [
      'a union with a part it cannot put into words',
      { anyOf: [{ type: 'string' }, { $ref: '#/$defs/x' }] },
      undefined,
    ],
    ['a type it does not know', { type: 'bigint' }, undefined],
  ]

  it.each(cases)('%s', (_name, schema, expected) => {
    expect(expectation(schema)).toBe(expected)
  })

  it('lists 20 values of an enum and counts the rest, even when it is one more', () => {
    const values = Array.from({ length: 25 }, (_, index) => `v${index}`)
    const listed = values
      .slice(0, 20)
      .map((value) => `"${value}"`)
      .join(', ')
    expect(expectation({ enum: values.slice(0, 21) })).toBe(`one of ${listed} and 1 more`)
    expect(expectation({ enum: values })).toBe(
      `one of ${values
        .slice(0, 20)
        .map((value) => `"${value}"`)
        .join(', ')} and 5 more`,
    )
    expect(expectation({ enum: values.slice(0, 20) })).toBe(
      `one of ${values
        .slice(0, 20)
        .map((value) => `"${value}"`)
        .join(', ')}`,
    )
  })
})

describe('fragmentAt', () => {
  const schema: JsonObject = {
    type: 'object',
    properties: {
      tags: { type: 'array', items: { type: 'string', maxLength: 5 } },
      author: { type: 'object', properties: { name: { type: 'string' } } },
    },
  }

  it('follows properties and the items of an array', () => {
    expect(fragmentAt(schema, [])).toBe(schema)
    expect(fragmentAt(schema, ['author', 'name'])).toEqual({ type: 'string' })
    expect(fragmentAt(schema, ['tags', '3'])).toEqual({ type: 'string', maxLength: 5 })
  })

  it('says nothing about a path the schema does not describe', () => {
    expect(fragmentAt(schema, ['missing'])).toBeUndefined()
    expect(fragmentAt(schema, ['author', 'missing'])).toBeUndefined()
    expect(fragmentAt(schema, ['tags', 'first'])).toBeUndefined()
    expect(fragmentAt(schema, ['author', '0'])).toBeUndefined()
  })
})

describe('issueSegments and label', () => {
  it('reads a path of keys, numbers and path segments as plain strings', () => {
    expect(issueSegments({ message: 'x' })).toEqual([])
    expect(issueSegments({ message: 'x', path: ['tags', 0, { key: 'name' }, { key: 2 }] })).toEqual(
      ['tags', '0', 'name', '2'],
    )
    expect(issueSegments({ message: 'x', path: [Symbol('s')] })).toEqual(['Symbol(s)'])
  })

  it('writes a path as a person would', () => {
    expect(label(['title'])).toBe('title')
    expect(label(['tags', '1'])).toBe('tags[1]')
    expect(label(['author', 'links', '2', 'url'])).toBe('author.links[2].url')
  })
})

describe('fixForIssue', () => {
  const frontmatter: FixSubject = { container: 'the frontmatter', noun: 'field' }
  const props: FixSubject = { container: 'the component "callout"', noun: 'prop' }
  const closed: JsonObject = {
    type: 'object',
    properties: { type: { type: 'string', enum: ['info', 'tip'] }, size: { type: 'string' } },
    additionalProperties: false,
  }

  it('names the field and what the schema accepts there', () => {
    expect(
      fixForIssue({
        subject: props,
        schema: closed,
        input: { type: 'warn' },
        segments: ['type'],
        message: 'Invalid option',
      }),
    ).toBe('Set the prop "type" to one of "info", "tip".')
  })

  it('tells which keys a closed object does not accept, and which it does', () => {
    expect(
      fixForIssue({
        subject: props,
        schema: closed,
        input: { type: 'tip', color: 'red' },
        segments: [],
        message: 'Unrecognized key: "color"',
      }),
    ).toBe(
      'Remove the prop "color" from the component "callout"; the props allowed there are: type, size.',
    )
    expect(
      fixForIssue({
        subject: props,
        schema: closed,
        input: { type: 'tip', color: 'red', weight: 3 },
        segments: [],
        message: 'Unrecognized keys',
      }),
    ).toBe(
      'Remove the props "color", "weight" from the component "callout"; the props allowed there are: type, size.',
    )
  })

  it('finds the unknown keys of a nested object', () => {
    const nested: JsonObject = { type: 'object', properties: { author: closed } }
    expect(
      fixForIssue({
        subject: frontmatter,
        schema: nested,
        input: { author: { type: 'tip', role: 'x' } },
        segments: ['author'],
        message: 'Unrecognized key: "role"',
      }),
    ).toBe(
      'Remove the field "role" from the field "author"; the fields allowed there are: type, size.',
    )
  })

  it('finds the unknown keys of an object inside an array', () => {
    const list: JsonObject = {
      type: 'object',
      properties: { items: { type: 'array', items: closed } },
    }
    expect(
      fixForIssue({
        subject: frontmatter,
        schema: list,
        input: { items: [{ type: 'tip' }, { type: 'tip', role: 'x' }] },
        segments: ['items', '1'],
        message: 'Unrecognized key: "role"',
      }),
    ).toBe(
      'Remove the field "role" from the field "items[1]"; the fields allowed there are: type, size.',
    )
  })

  it('says so when a closed object accepts no key at all', () => {
    const empty: JsonObject = { type: 'object', properties: {}, additionalProperties: false }
    expect(
      fixForIssue({
        subject: props,
        schema: empty,
        input: { id: 1 },
        segments: [],
        message: 'Unrecognized key: "id"',
      }),
    ).toBe('Remove the prop "id" from the component "callout"; no props are allowed there.')
  })

  it('does not call a key unknown when the object is open or the value is not an object', () => {
    const open: JsonObject = { type: 'object', properties: { a: { type: 'string' } } }
    expect(
      fixForIssue({
        subject: frontmatter,
        schema: open,
        input: { a: 1, extra: true },
        segments: [],
        message: 'm',
      }),
    ).toBe('Set the frontmatter to an object with the keys a.')
    expect(
      fixForIssue({
        subject: props,
        schema: closed,
        input: ['not', 'an', 'object'],
        segments: [],
        message: 'Invalid input: expected object, received array',
      }),
    ).toBe('Set the component "callout" to an object with the keys type, size.')
  })

  it('falls back to the message of the library where the schema cannot say', () => {
    expect(
      fixForIssue({
        subject: frontmatter,
        schema: closed,
        input: {},
        segments: ['links', 'a/b'],
        message: 'Invalid input: expected number, received string',
      }),
    ).toBe(
      'Change the field "links.a/b" to a value that the schema of the frontmatter accepts: Invalid input: expected number, received string',
    )
    expect(
      fixForIssue({
        subject: props,
        schema: null,
        input: {},
        segments: [],
        message: 'must be a kind',
      }),
    ).toBe(
      'Change the component "callout" to a value that the schema of the component "callout" accepts: must be a kind',
    )
    expect(
      fixForIssue({
        subject: frontmatter,
        schema: { type: 'object', properties: { x: { $ref: '#/$defs/x' } } },
        input: {},
        segments: ['x'],
        message: 'bad x',
      }),
    ).toBe('Change the field "x" to a value that the schema of the frontmatter accepts: bad x')
  })
})
