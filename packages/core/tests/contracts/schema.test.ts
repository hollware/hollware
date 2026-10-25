import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod'

import type { DescribedSchema } from '../../src/config/types.ts'
import type { Contract } from '../../src/contracts/index.ts'
import { collectionOf, markdownOf, run } from './support.ts'

const schema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).max(160),
  date: z.iso.date(),
  tags: z.array(z.string().min(1)).min(1),
  cta: z.enum(['newsletter', 'docs', 'github']).optional(),
  author: z.strictObject({ name: z.string(), links: z.array(z.url()).max(3) }).optional(),
})

const VALID = { title: 'Edge caching', description: 'How.', date: '2026-10-12', tags: ['cdn'] }

function violation(
  path: string,
  message: string,
  fix: string,
  code: string,
  params: Record<string, string | number>,
) {
  return { contract: 'schema', severity: 'error', path, message, fix, code, params }
}

const CTA_VALUES = '"newsletter", "docs", "github"'

describe('the schema contract', () => {
  it('passes a frontmatter that the schema accepts', async () => {
    const verdict = await run({
      collection: collectionOf({ schema }),
      markdown: markdownOf({ frontmatter: VALID }),
    })
    expect(verdict.errors).toStrictEqual([])
    expect(verdict.warnings).toStrictEqual([])
    expect(verdict.ok).toBe(true)
  })

  const cases: [string, Record<string, unknown>, ReturnType<typeof violation>[]][] = [
    [
      'a description over its limit',
      { ...VALID, description: 'x'.repeat(184) },
      [
        violation(
          '/frontmatter/description',
          'Too big: expected string to have <=160 characters',
          'Set the field "description" to a string of 1 to 160 characters.',
          'schema.too_big',
          { field: 'description', length: 184, maximum: 160, origin: 'string' },
        ),
      ],
    ],
    [
      'a missing required field',
      { description: 'How.', date: '2026-10-12', tags: ['cdn'] },
      [
        violation(
          '/frontmatter/title',
          'Invalid input: expected string, received undefined',
          'Set the field "title" to a string of at least 1 character.',
          'schema.missing',
          { field: 'title', expected: 'string' },
        ),
      ],
    ],
    [
      'an empty first item of an array',
      { ...VALID, tags: ['', 'ok'] },
      [
        violation(
          '/frontmatter/tags/0',
          'Too small: expected string to have >=1 characters',
          'Set the field "tags[0]" to a string of at least 1 character.',
          'schema.too_small',
          { field: 'tags[0]', length: 0, minimum: 1, origin: 'string' },
        ),
      ],
    ],
    [
      'an empty item of an array',
      { ...VALID, tags: ['ok', ''] },
      [
        violation(
          '/frontmatter/tags/1',
          'Too small: expected string to have >=1 characters',
          'Set the field "tags[1]" to a string of at least 1 character.',
          'schema.too_small',
          { field: 'tags[1]', length: 0, minimum: 1, origin: 'string' },
        ),
      ],
    ],
    [
      'an empty array',
      { ...VALID, tags: [] },
      [
        violation(
          '/frontmatter/tags',
          'Too small: expected array to have >=1 items',
          'Set the field "tags" to an array of at least 1 item, each a string of at least 1 character.',
          'schema.too_small',
          { field: 'tags', length: 0, minimum: 1, origin: 'array' },
        ),
      ],
    ],
    [
      'a value outside an enum',
      { ...VALID, cta: 'rss' },
      [
        violation(
          '/frontmatter/cta',
          'Invalid option: expected one of "newsletter"|"docs"|"github"',
          'Set the field "cta" to one of "newsletter", "docs", "github".',
          'schema.invalid_value',
          { field: 'cta', length: 3, values: CTA_VALUES },
        ),
      ],
    ],
    [
      'a date that is not a date',
      { ...VALID, date: 'tomorrow' },
      [
        violation(
          '/frontmatter/date',
          'Invalid ISO date',
          'Set the field "date" to a string in the format "date".',
          'schema.invalid_format',
          { field: 'date', format: 'date', length: 8, origin: 'string' },
        ),
      ],
    ],
    [
      'a key a closed object does not accept',
      { ...VALID, author: { name: 'Ana', links: [], role: 'editor' } },
      [
        violation(
          '/frontmatter/author',
          'Unrecognized key: "role"',
          'Remove the field "role" from the field "author"; the fields allowed there are: name, links.',
          'schema.unrecognized_keys',
          { field: 'author', keys: 'role' },
        ),
      ],
    ],
    [
      'a wrong value deep inside an array of an object',
      { ...VALID, author: { name: 'Ana', links: ['https://a.dev', 'nope'] } },
      [
        violation(
          '/frontmatter/author/links/1',
          'Invalid URL',
          'Set the field "author.links[1]" to a string in the format "uri".',
          'schema.invalid_format',
          { field: 'author.links[1]', format: 'url', length: 4 },
        ),
      ],
    ],
    [
      'several problems, listed by path',
      { title: '', description: 'How.', date: '2026-10-12', tags: ['cdn'], cta: 'x' },
      [
        violation(
          '/frontmatter/cta',
          'Invalid option: expected one of "newsletter"|"docs"|"github"',
          'Set the field "cta" to one of "newsletter", "docs", "github".',
          'schema.invalid_value',
          { field: 'cta', length: 1, values: CTA_VALUES },
        ),
        violation(
          '/frontmatter/title',
          'Too small: expected string to have >=1 characters',
          'Set the field "title" to a string of at least 1 character.',
          'schema.too_small',
          { field: 'title', length: 0, minimum: 1, origin: 'string' },
        ),
      ],
    ],
  ]

  it.each(cases)('reports %s', async (_name, frontmatter, expected) => {
    const verdict = await run({
      collection: collectionOf({ schema }),
      markdown: markdownOf({ frontmatter }),
    })
    expect(verdict.errors).toStrictEqual(expected)
    expect(verdict.warnings).toStrictEqual([])
    expect(verdict.ok).toBe(false)
  })

  it('writes the path of an issue as a JSON Pointer, escaping ~ and /', async () => {
    const verdict = await run({
      collection: collectionOf({
        schema: z.object({ links: z.record(z.string(), z.number()) }),
      }),
      markdown: markdownOf({ frontmatter: { links: { 'a/b': 'x', 'c~d': 'y' } } }),
    })
    expect(verdict.errors).toStrictEqual([
      violation(
        '/frontmatter/links/a~1b',
        'Invalid input: expected number, received string',
        'Change the field "links.a/b" to a value that the schema of the frontmatter accepts: Invalid input: expected number, received string',
        'schema.invalid_type',
        { field: 'links.a/b', expected: 'number', length: 1 },
      ),
      violation(
        '/frontmatter/links/c~0d',
        'Invalid input: expected number, received string',
        'Change the field "links.c~d" to a value that the schema of the frontmatter accepts: Invalid input: expected number, received string',
        'schema.invalid_type',
        { field: 'links.c~d', expected: 'number', length: 1 },
      ),
    ])
  })

  it('falls back to the message of the library when the schema does not convert to JSON Schema', async () => {
    const unconvertible: DescribedSchema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ issues: [{ message: 'must be a kind', path: ['kind'] }] }),
        jsonSchema: {
          input: () => {
            throw new Error('this schema has no JSON Schema')
          },
          output: () => {
            throw new Error('this schema has no JSON Schema')
          },
        },
      },
    }
    const verdict = await run({
      collection: collectionOf({ schema: unconvertible }),
      markdown: markdownOf({ frontmatter: { kind: 1 } }),
    })
    expect(verdict.errors).toStrictEqual([
      violation(
        '/frontmatter/kind',
        'must be a kind',
        'Change the field "kind" to a value that the schema of the frontmatter accepts: must be a kind',
        'schema.invalid',
        { field: 'kind' },
      ),
    ])
  })

  it('waits for a schema that validates asynchronously', async () => {
    const asynchronous: DescribedSchema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) =>
          Promise.resolve(
            value === 'ok' ? { value } : { issues: [{ message: 'must be ok', path: [] }] },
          ),
        jsonSchema: { input: () => ({ const: 'ok' }), output: () => ({ const: 'ok' }) },
      },
    }
    const verdict = await run({
      collection: collectionOf({ schema: asynchronous }),
      markdown: markdownOf({ frontmatter: { never: 'an object' } }),
    })
    expect(verdict.errors).toStrictEqual([
      violation(
        '/frontmatter',
        'must be ok',
        'Set the frontmatter to exactly "ok".',
        'schema.invalid',
        {
          field: '',
        },
      ),
    ])
  })

  it('gives the contracts of the collection what the schema returned, not the raw frontmatter', async () => {
    const withDefault = z.object({
      title: z.string(),
      cta: z.enum(['newsletter', 'docs']).default('newsletter'),
    })
    const seen: unknown[] = []
    const reader: Contract<unknown> = {
      id: 'reads-frontmatter',
      severity: 'warning',
      description: 'Looks at the frontmatter.',
      check: ({ frontmatter }) => {
        seen.push(frontmatter)
        return []
      },
    }
    await run({
      collection: collectionOf({ schema: withDefault, contracts: [reader] }),
      markdown: markdownOf({ frontmatter: { title: 'A', extra: 'is stripped' } }),
    })
    expect(seen).toStrictEqual([{ title: 'A', cta: 'newsletter' }])
  })
})
