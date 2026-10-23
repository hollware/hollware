import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod'

import type { Phase } from '../../src/contracts/index.ts'
import type { ComponentUse } from '../../src/markdown/types.ts'
import { collectionOf, markdownOf, run } from './support.ts'

const components = {
  callout: { props: z.strictObject({ type: z.enum(['info', 'warning', 'tip']) }) },
  youtube: { props: z.strictObject({ id: z.string().regex(/^[\w-]{11}$/) }) },
  divider: { props: z.strictObject({}) },
}

const PHASES: Phase[] = ['write', 'publish']

function runWith(uses: readonly ComponentUse[], phase: Phase = 'write') {
  return run({
    phase,
    collection: collectionOf({ components }),
    markdown: markdownOf({ components: uses }),
  })
}

function violation(message: string, fix: string, line: number) {
  return { contract: 'components', severity: 'error', path: '/body', message, fix, line }
}

describe('the components contract', () => {
  it('passes the components whose props match their schema', async () => {
    const verdict = await runWith([
      { name: 'callout', props: { type: 'tip' }, line: 3 },
      { name: 'youtube', props: { id: 'dQw4w9WgXcQ' }, line: 9 },
      { name: 'divider', props: {}, line: 12 },
    ])
    expect(verdict.errors).toStrictEqual([])
    expect(verdict.ok).toBe(true)
  })

  const cases: [string, ComponentUse[], ReturnType<typeof violation>[]][] = [
    [
      'a value outside an enum',
      [{ name: 'callout', props: { type: 'warn' }, line: 7 }],
      [
        violation(
          'The prop "type" of the component "callout" is invalid: Invalid option: expected one of "info"|"warning"|"tip"',
          'Set the prop "type" to one of "info", "warning", "tip".',
          7,
        ),
      ],
    ],
    [
      'a prop the schema does not have',
      [{ name: 'callout', props: { type: 'tip', color: 'red' }, line: 3 }],
      [
        violation(
          'The props of the component "callout" are invalid: Unrecognized key: "color"',
          'Remove the prop "color" from the component "callout"; the props allowed there are: type.',
          3,
        ),
      ],
    ],
    [
      'two props the schema does not have',
      [{ name: 'callout', props: { type: 'tip', color: 'red', size: 'xl' }, line: 3 }],
      [
        violation(
          'The props of the component "callout" are invalid: Unrecognized keys: "color", "size"',
          'Remove the props "color", "size" from the component "callout"; the props allowed there are: type.',
          3,
        ),
      ],
    ],
    [
      'a missing required prop',
      [{ name: 'youtube', props: {}, line: 14 }],
      [
        violation(
          'The prop "id" of the component "youtube" is invalid: Invalid input: expected string, received undefined',
          'Set the prop "id" to a string matching the pattern ^[\\w-]{11}$.',
          14,
        ),
      ],
    ],
    [
      'a prop that does not match its pattern',
      [{ name: 'youtube', props: { id: 'short' }, line: 2 }],
      [
        violation(
          'The prop "id" of the component "youtube" is invalid: Invalid string: must match pattern /^[\\w-]{11}$/',
          'Set the prop "id" to a string matching the pattern ^[\\w-]{11}$.',
          2,
        ),
      ],
    ],
    [
      'a prop on a component that takes none',
      [{ name: 'divider', props: { style: 'dashed' }, line: 5 }],
      [
        violation(
          'The props of the component "divider" are invalid: Unrecognized key: "style"',
          'Remove the prop "style" from the component "divider"; no props are allowed there.',
          5,
        ),
      ],
    ],
    [
      'uses given out of order, reported by line',
      [
        { name: 'callout', props: { type: 'x' }, line: 20 },
        { name: 'callout', props: { type: 'y' }, line: 5 },
      ],
      [
        violation(
          'The prop "type" of the component "callout" is invalid: Invalid option: expected one of "info"|"warning"|"tip"',
          'Set the prop "type" to one of "info", "warning", "tip".',
          5,
        ),
        violation(
          'The prop "type" of the component "callout" is invalid: Invalid option: expected one of "info"|"warning"|"tip"',
          'Set the prop "type" to one of "info", "warning", "tip".',
          20,
        ),
      ],
    ],
  ]

  it.each(cases)('reports %s', async (_name, uses, expected) => {
    for (const phase of PHASES) {
      const verdict = await runWith(uses, phase)
      expect(verdict.errors).toStrictEqual(expected)
      expect(verdict.ok).toBe(false)
    }
  })

  it('leaves a use without a line without one', async () => {
    const verdict = await runWith([{ name: 'callout', props: { type: 'x' } }])
    expect(verdict.errors).toStrictEqual([
      {
        contract: 'components',
        severity: 'error',
        path: '/body',
        message:
          'The prop "type" of the component "callout" is invalid: Invalid option: expected one of "info"|"warning"|"tip"',
        fix: 'Set the prop "type" to one of "info", "warning", "tip".',
      },
    ])
  })

  it('does not look at a component the collection does not allow: unknown-component does', async () => {
    const verdict = await runWith([{ name: 'figure', props: { whatever: 1 }, line: 4 }])
    expect(verdict.errors).toStrictEqual([])
  })
})
