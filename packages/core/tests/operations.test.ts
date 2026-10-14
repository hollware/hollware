import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod'

import {
  defineOperation,
  getEntry,
  OPERATIONS,
  publish,
  updateDraft,
} from '../src/operations/index.ts'

// Fails when: an operation of v0.1 is added, removed or renamed; its effect, scopes or outcomes
// leave the table of the v0.1 plan; `tools/list` would stop being sorted by name; an input stops
// being a strict object or an output an object whose `outcome` lists exactly the outcomes of the
// spec, as JSON Schema shows them to agents; or an input default moves.

const ENTRY_ID = 'ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW'

const jsonSchema = (schema: z.ZodType, io: 'input' | 'output') =>
  schema['~standard'].jsonSchema[io]({ target: 'draft-2020-12' })

describe('operation specs', () => {
  it('are the nine operations of v0.1, sorted by name, as tools/list shows them', () => {
    const names = OPERATIONS.map((operation) => operation.name)
    expect(names).toEqual([
      'create_draft',
      'describe_site',
      'get_entry',
      'get_translations',
      'list_entries',
      'publish',
      'unpublish',
      'update_draft',
      'validate',
    ])
    expect(names).toEqual([...names].sort())
  })

  it('have the effects, scopes and outcomes of the table in PLAN.md', () => {
    const table = Object.fromEntries(
      OPERATIONS.map((operation) => {
        const outcomes = Object.entries(operation.outcomes)
        return [
          operation.name,
          {
            effect: operation.effect,
            scopes: operation.scopes,
            outcomes: outcomes.map(([outcome]) => outcome),
            errors: outcomes.filter(([, info]) => info.isError).map(([outcome]) => outcome),
          },
        ]
      }),
    )
    expect(table).toEqual({
      create_draft: {
        effect: 'write',
        scopes: ['content:write'],
        outcomes: ['saved', 'refused'],
        errors: ['refused'],
      },
      describe_site: { effect: 'read', scopes: ['content:read'], outcomes: ['ok'], errors: [] },
      get_entry: {
        effect: 'read',
        scopes: ['content:read'],
        outcomes: ['ok', 'not_found'],
        errors: ['not_found'],
      },
      get_translations: {
        effect: 'read',
        scopes: ['content:read'],
        outcomes: ['ok', 'not_found'],
        errors: ['not_found'],
      },
      list_entries: { effect: 'read', scopes: ['content:read'], outcomes: ['ok'], errors: [] },
      publish: {
        effect: 'write',
        scopes: ['content:publish'],
        outcomes: [
          'published',
          'scheduled',
          'blocked',
          'needs_acknowledgement',
          'conflict',
          'not_found',
        ],
        errors: ['blocked', 'conflict', 'not_found'],
      },
      unpublish: {
        effect: 'destructive',
        scopes: ['content:publish'],
        outcomes: ['unpublished', 'not_found'],
        errors: ['not_found'],
      },
      update_draft: {
        effect: 'edit',
        scopes: ['content:write'],
        outcomes: ['saved', 'unchanged', 'conflict', 'not_found', 'refused'],
        errors: ['conflict', 'not_found', 'refused'],
      },
      validate: { effect: 'read', scopes: ['content:read'], outcomes: ['ok'], errors: [] },
    })
  })

  it('show agents a strict object as input and an object with its outcomes as output', () => {
    const shapes = OPERATIONS.map((operation) => {
      const input = jsonSchema(operation.input, 'input')
      const output = jsonSchema(operation.output, 'output')
      const properties = output['properties']
      const outcome =
        typeof properties === 'object' && properties !== null && 'outcome' in properties
          ? properties.outcome
          : undefined
      return {
        name: operation.name,
        input: [input['type'], input['additionalProperties']],
        output: [output['type'], output['required']],
        outcome,
      }
    })
    expect(shapes).toEqual(
      OPERATIONS.map((operation) => ({
        name: operation.name,
        input: ['object', false],
        output: ['object', expect.arrayContaining(['outcome'])],
        outcome: { type: 'string', enum: Object.keys(operation.outcomes) },
      })),
    )
  })

  it('have a title and a description for the agent', () => {
    for (const operation of OPERATIONS) {
      expect(operation.title.length, operation.name).toBeGreaterThan(5)
      expect(operation.description.length, operation.name).toBeGreaterThan(60)
    }
  })

  it('fill the input defaults and refuse fields they do not know', () => {
    expect(publish.input.parse({ id: ENTRY_ID, version: 3 })).toEqual({
      id: ENTRY_ID,
      version: 3,
      acknowledgeWarnings: [],
      group: [],
    })
    expect(getEntry.input.parse({ collection: 'blog', locale: 'en', slug: 'hello-world' })).toEqual(
      { collection: 'blog', locale: 'en', slug: 'hello-world', formats: ['markdown'] },
    )
    const misspelled = updateDraft.input.safeParse({
      id: ENTRY_ID,
      version: 1,
      markdown: '# Hi',
      versions: 2,
    })
    expect(misspelled.success).toBe(false)
    expect(misspelled.error?.issues.map((issue) => issue.code)).toEqual(['unrecognized_keys'])
  })

  it('make a missing or an unknown outcome a type error', () => {
    const output = z.object({ outcome: z.enum(['ok', 'gone']) })
    const base = {
      name: 'probe',
      title: 'A probe',
      description: 'A spec that exists only to be type-checked.',
      input: z.strictObject({}),
      output,
      scopes: [],
      effect: 'read',
    } as const
    const complete = defineOperation({
      ...base,
      outcomes: { ok: { isError: false }, gone: { isError: true } },
    })
    // @ts-expect-error -- `gone` has no entry in `outcomes`.
    defineOperation({ ...base, outcomes: { ok: { isError: false } } })
    defineOperation({
      ...base,
      // @ts-expect-error -- `lost` is no outcome of the output.
      outcomes: { ok: { isError: false }, gone: { isError: true }, lost: { isError: true } },
    })
    expect(Object.keys(complete.outcomes)).toEqual(['ok', 'gone'])
  })
})
