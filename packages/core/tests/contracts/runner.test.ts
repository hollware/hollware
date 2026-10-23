import { describe, expect, it } from 'vite-plus/test'
import * as z from 'zod'

import type { DescribedSchema } from '../../src/config/types.ts'
import { COMPONENTS } from '../../src/contracts/components.ts'
import { RAW_HTML } from '../../src/contracts/safety.ts'
import {
  BUILT_IN_CONTRACT_IDS,
  REFUSAL_CONTRACT_IDS,
  contracts,
  type Contract,
  type ContractContext,
  type ContractFinding,
  type Phase,
  type Severity,
} from '../../src/contracts/index.ts'
import {
  collectionOf,
  ENTRY_ID,
  fakeEntries,
  FRONTMATTER,
  markdownOf,
  NO_LOOKUPS,
  run,
  stored,
} from './support.ts'

function finding(path: string, line?: number, message = `Problem at ${path}`): ContractFinding {
  return { path, message, fix: `Fix ${path}`, ...(line === undefined ? {} : { line }) }
}

function rule(
  id: string,
  severity: Severity,
  findings: readonly ContractFinding[],
  phases?: readonly Phase[],
): Contract<unknown> {
  return {
    id,
    severity,
    ...(phases === undefined ? {} : { phases }),
    description: `The rule ${id}.`,
    check: () => findings,
  }
}

describe('the phases', () => {
  it('run in write the contracts declared for it, and in publish every contract', async () => {
    const ran: string[] = []
    const watching = (id: string, phases?: readonly Phase[]): Contract<unknown> => ({
      id,
      severity: 'error',
      ...(phases === undefined ? {} : { phases }),
      description: `The rule ${id}.`,
      check: () => {
        ran.push(id)
        return [finding(`/${id}`)]
      },
    })
    const collection = collectionOf({
      contracts: [
        watching('only-publish', ['publish']),
        watching('only-write', ['write']),
        watching('both'),
        watching('both-listed', ['publish', 'write']),
      ],
    })

    const written = await run({ collection, phase: 'write' })
    expect(ran).toStrictEqual(['only-write', 'both', 'both-listed'])
    expect(written.phase).toBe('write')
    expect(written.errors.map((violation) => violation.contract)).toStrictEqual([
      'only-write',
      'both',
      'both-listed',
    ])

    ran.length = 0
    const published = await run({ collection, phase: 'publish' })
    expect(ran).toStrictEqual(['only-publish', 'only-write', 'both', 'both-listed'])
    expect(published.phase).toBe('publish')
    expect(published.errors.map((violation) => violation.contract)).toStrictEqual([
      'only-publish',
      'only-write',
      'both',
      'both-listed',
    ])
  })
})

describe('the context of a contract', () => {
  it('carries the coordinates of the entry, what the schema returned and the lookup', async () => {
    const seen: ContractContext<unknown>[] = []
    const watcher: Contract<unknown> = {
      id: 'watcher',
      severity: 'warning',
      description: 'Looks at the context.',
      check: (context) => {
        seen.push(context)
        return []
      },
    }
    const markdown = markdownOf()
    const { lookup } = fakeEntries()
    await run({
      collection: collectionOf({ contracts: [watcher] }),
      locale: 'en',
      slug: 'a-slug',
      entryId: null,
      phase: 'publish',
      markdown,
      entries: lookup,
    })
    const [context] = seen
    expect(seen).toHaveLength(1)
    expect(context).toMatchObject({
      site: 'acme',
      collection: 'blog',
      locale: 'en',
      slug: 'a-slug',
      entryId: null,
      phase: 'publish',
    })
    expect(context?.frontmatter).toStrictEqual(FRONTMATTER)
    expect(context?.markdown).toBe(markdown)
    expect(context?.entries).toBe(lookup)
    expect(Object.isFrozen(context)).toBe(true)
  })

  it('carries the id of an entry that exists', async () => {
    const seen: (string | null)[] = []
    const watcher: Contract<unknown> = {
      id: 'watcher',
      severity: 'warning',
      description: 'Looks at the id.',
      check: ({ entryId }) => {
        seen.push(entryId)
        return []
      },
    }
    await run({ collection: collectionOf({ contracts: [watcher] }) })
    expect(seen).toStrictEqual([ENTRY_ID])
  })
})

describe('the schema as a gate', () => {
  it('stops the contracts that read the frontmatter and lets the others run', async () => {
    const ran: string[] = []
    const reader: Contract<unknown> = {
      id: 'reads-frontmatter',
      severity: 'error',
      description: 'Reads the frontmatter.',
      check: () => {
        ran.push('reads-frontmatter')
        return [finding('/frontmatter/title')]
      },
    }
    const { lookup, calls } = fakeEntries()
    const verdict = await run({
      phase: 'publish',
      collection: collectionOf({
        translationGroupField: 'translationGroup',
        contracts: [
          reader,
          contracts.translationPair(),
          contracts.internalLinksResolve(),
          contracts.imagesHaveAlt(),
        ],
      }),
      markdown: {
        ...markdownOf({ frontmatter: { title: 'Only a title' } }),
        extracted: {
          headings: [],
          words: 0,
          codeWords: 0,
          components: [],
          links: [
            {
              href: '/blog/x/',
              kind: 'internal',
              line: 3,
              target: { collection: 'blog', locale: 'es', slug: 'x' },
            },
          ],
          images: [{ src: '/a.png', alt: '', line: 4 }],
          disallowed: [{ kind: 'raw-html', name: 'b', line: 2 }],
        },
      },
      entries: lookup,
    })
    expect(ran).toStrictEqual([])
    expect(calls.map((call) => call.method)).toStrictEqual(['lookupMany'])
    expect(verdict.errors.map((violation) => violation.contract)).toStrictEqual([
      'schema',
      'schema',
      'raw-html',
      'internal-links-resolve',
      'images-have-alt',
    ])
    expect(verdict.ok).toBe(false)
  })

  it('lets them run once the schema passes', async () => {
    const ran: string[] = []
    const reader: Contract<unknown> = {
      id: 'reads-frontmatter',
      severity: 'error',
      description: 'Reads the frontmatter.',
      check: () => {
        ran.push('reads-frontmatter')
        return []
      },
    }
    await run({ collection: collectionOf({ contracts: [reader] }) })
    expect(ran).toStrictEqual(['reads-frontmatter'])
  })

  it('is an error of the schema, and nothing else runs on it, when the schema itself throws', async () => {
    const ran: string[] = []
    const reader: Contract<unknown> = {
      id: 'reads-frontmatter',
      severity: 'error',
      description: 'Reads the frontmatter.',
      check: () => {
        ran.push('reads-frontmatter')
        return []
      },
    }
    const throwing: DescribedSchema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => {
          throw new TypeError('the schema is broken')
        },
        jsonSchema: { input: () => ({}), output: () => ({}) },
      },
    }
    const verdict = await run({
      collection: collectionOf({ schema: throwing, contracts: [reader] }),
    })
    expect(ran).toStrictEqual([])
    expect(verdict.errors).toStrictEqual([
      {
        contract: 'schema',
        severity: 'error',
        path: '',
        message:
          'The contract "schema" failed with an error while it checked this entry: TypeError: the schema is broken',
        fix: 'This is a problem in the config of the site, not in the entry: report it to whoever maintains the config, naming the contract "schema".',
      },
    ])
  })
})

describe('the verdict', () => {
  it('splits errors and warnings by the severity of the contract, and is ok without errors', async () => {
    const collection = collectionOf({
      contracts: [
        rule('a-warning', 'warning', [finding('/frontmatter/title')]),
        rule('an-error', 'error', [finding('/frontmatter/description')]),
      ],
    })
    const verdict = await run({ collection })
    expect(verdict.errors).toStrictEqual([
      {
        contract: 'an-error',
        severity: 'error',
        path: '/frontmatter/description',
        message: 'Problem at /frontmatter/description',
        fix: 'Fix /frontmatter/description',
      },
    ])
    expect(verdict.warnings).toStrictEqual([
      {
        contract: 'a-warning',
        severity: 'warning',
        path: '/frontmatter/title',
        message: 'Problem at /frontmatter/title',
        fix: 'Fix /frontmatter/title',
      },
    ])
    expect(verdict.ok).toBe(false)
  })

  it('is ok when there are only warnings', async () => {
    const verdict = await run({
      collection: collectionOf({
        contracts: [rule('a-warning', 'warning', [finding('/frontmatter/title')])],
      }),
    })
    expect(verdict.errors).toStrictEqual([])
    expect(verdict.warnings).toHaveLength(1)
    expect(verdict.ok).toBe(true)
  })

  it('is ok and empty when nothing is wrong', async () => {
    const verdict = await run()
    expect(verdict.ok).toBe(true)
    expect(verdict.errors).toStrictEqual([])
    expect(verdict.warnings).toStrictEqual([])
    expect(verdict.phase).toBe('write')
    expect(verdict.contractsHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps the line of a finding and leaves out the line a finding does not have', async () => {
    const verdict = await run({
      collection: collectionOf({
        contracts: [rule('lines', 'error', [finding('/body', 12), finding('/frontmatter/title')])],
      }),
    })
    expect(verdict.errors.map((violation) => violation.line)).toStrictEqual([undefined, 12])
    expect(Object.keys(verdict.errors[0] ?? {})).toStrictEqual([
      'contract',
      'severity',
      'path',
      'message',
      'fix',
    ])
    expect(Object.keys(verdict.errors[1] ?? {})).toStrictEqual([
      'contract',
      'severity',
      'path',
      'message',
      'fix',
      'line',
    ])
  })
})

describe('the order of the violations', () => {
  const markdown = markdownOf({
    disallowed: [
      { kind: 'unsafe-url', name: 'javascript:x', line: 1 },
      { kind: 'raw-html', name: 'b', line: 9 },
    ],
    components: [{ name: 'callout', props: { type: 'x' }, line: 5 }],
  })
  const collection = collectionOf({
    components: { callout: { props: z.strictObject({ type: z.enum(['info']) }) } },
    contracts: [
      rule('second', 'error', [finding('/body', 3)]),
      rule('first', 'error', [finding('/frontmatter/title')]),
    ],
  })

  it('are the built-in contracts in their own order, then the collection’s in the order of its config', async () => {
    const verdict = await run({ collection, markdown })
    expect(verdict.errors.map((violation) => violation.contract)).toStrictEqual([
      'components',
      'raw-html',
      'unsafe-url',
      'second',
      'first',
    ])
  })

  it('put the schema first of all', async () => {
    const verdict = await run({
      collection,
      markdown: markdownOf({
        frontmatter: { title: '' },
        disallowed: [{ kind: 'raw-html', name: 'b', line: 9 }],
      }),
    })
    expect(verdict.errors.map((violation) => violation.contract)).toStrictEqual([
      'schema',
      'schema',
      'schema',
      'raw-html',
    ])
  })

  it('put the findings of one contract by line, then by path, the ones without a line first', async () => {
    const verdict = await run({
      collection: collectionOf({
        contracts: [
          rule('scrambled', 'error', [
            finding('/body', 9),
            finding('/frontmatter/title'),
            finding('/body', 2),
            finding('/frontmatter/description'),
            finding('/b', 5),
            finding('/a', 5),
            finding('/a', 5, 'second at the same place'),
            finding('/a', 5, 'third at the same place'),
          ]),
        ],
      }),
    })
    expect(
      verdict.errors.map((violation) => [violation.path, violation.line, violation.message]),
    ).toStrictEqual([
      ['/frontmatter/description', undefined, 'Problem at /frontmatter/description'],
      ['/frontmatter/title', undefined, 'Problem at /frontmatter/title'],
      ['/body', 2, 'Problem at /body'],
      ['/a', 5, 'Problem at /a'],
      ['/a', 5, 'second at the same place'],
      ['/a', 5, 'third at the same place'],
      ['/b', 5, 'Problem at /b'],
      ['/body', 9, 'Problem at /body'],
    ])
  })

  it('does not change with the order the contract hands its findings over in', async () => {
    const findings = [finding('/body', 9), finding('/body', 2), finding('/frontmatter/title')]
    const forward = await run({
      collection: collectionOf({ contracts: [rule('r', 'error', findings)] }),
    })
    const backward = await run({
      collection: collectionOf({ contracts: [rule('r', 'error', findings.toReversed())] }),
    })
    expect(backward).toStrictEqual(forward)
  })

  it('are the same every time for the same input', async () => {
    const first = await run({ collection, markdown, phase: 'publish' })
    const second = await run({ collection, markdown, phase: 'publish' })
    expect(second).toStrictEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})

describe('a contract that fails', () => {
  const FIX =
    'This is a problem in the config of the site, not in the entry: report it to whoever maintains the config, naming the contract'

  function throwing(
    id: string,
    severity: Severity,
    check: Contract<unknown>['check'],
  ): Contract<unknown> {
    return { id, severity, description: `The rule ${id}.`, check }
  }

  it('becomes an error of that contract with a fix for whoever maintains the config', async () => {
    const verdict = await run({
      collection: collectionOf({
        contracts: [
          throwing('boom', 'error', () => {
            throw new Error('boom')
          }),
        ],
      }),
    })
    expect(verdict.errors).toStrictEqual([
      {
        contract: 'boom',
        severity: 'error',
        path: '',
        message:
          'The contract "boom" failed with an error while it checked this entry: Error: boom',
        fix: `${FIX} "boom".`,
      },
    ])
    expect(verdict.ok).toBe(false)
  })

  it('is an error even when the contract is a warning, and also when it rejects', async () => {
    const verdict = await run({
      collection: collectionOf({
        contracts: [throwing('soft', 'warning', () => Promise.reject(new RangeError('too far')))],
      }),
    })
    expect(verdict.warnings).toStrictEqual([])
    expect(verdict.errors).toStrictEqual([
      {
        contract: 'soft',
        severity: 'error',
        path: '',
        message:
          'The contract "soft" failed with an error while it checked this entry: RangeError: too far',
        fix: `${FIX} "soft".`,
      },
    ])
  })

  it('does not stop the other contracts', async () => {
    const verdict = await run({
      collection: collectionOf({
        contracts: [
          rule('before', 'error', [finding('/body', 1)]),
          throwing('boom', 'error', () => {
            throw new Error('boom')
          }),
          rule('after', 'warning', [finding('/body', 2)]),
        ],
      }),
    })
    expect(verdict.errors.map((violation) => violation.contract)).toStrictEqual(['before', 'boom'])
    expect(verdict.warnings.map((violation) => violation.contract)).toStrictEqual(['after'])
  })

  it('says what was thrown when it is not an Error, and survives a value that cannot be written', async () => {
    const verdict = await run({
      collection: collectionOf({
        contracts: [
          throwing('text', 'error', () => Promise.reject('just a string')),
          throwing('bare', 'error', () => Promise.reject(Object.create(null))),
        ],
      }),
    })
    expect(verdict.errors.map((violation) => violation.message)).toStrictEqual([
      'The contract "text" failed with an error while it checked this entry: just a string',
      'The contract "bare" failed with an error while it checked this entry: an error that cannot be described',
    ])
  })

  it('clips a long error message to 200 characters', async () => {
    const verdict = await run({
      collection: collectionOf({
        contracts: [
          throwing('long', 'error', () => {
            throw new Error('x'.repeat(500))
          }),
        ],
      }),
    })
    expect(verdict.errors[0]?.message).toBe(
      `The contract "long" failed with an error while it checked this entry: Error: ${'x'.repeat(193)}…`,
    )
  })

  it('includes a built-in contract whose own schema throws', async () => {
    const broken: DescribedSchema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => {
          throw new Error('props schema is broken')
        },
        jsonSchema: { input: () => ({}), output: () => ({}) },
      },
    }
    const verdict = await run({
      collection: collectionOf({ components: { callout: { props: broken } } }),
      markdown: markdownOf({ components: [{ name: 'callout', props: {}, line: 2 }] }),
    })
    expect(verdict.errors).toStrictEqual([
      {
        contract: 'components',
        severity: 'error',
        path: '',
        message:
          'The contract "components" failed with an error while it checked this entry: Error: props schema is broken',
        fix: `${FIX} "components".`,
      },
    ])
  })
})

describe('a finding without a fix', () => {
  it('gets the description of its rule, and keeps its severity and message', async () => {
    const verdict = await run({
      collection: collectionOf({
        contracts: [
          {
            id: 'no-fix',
            severity: 'warning',
            description: 'A title of at most 60 characters.',
            check: () => [
              { path: '/frontmatter/title', message: 'The title is long.', fix: '' },
              { path: '/frontmatter/description', message: 'Also long.', fix: '   ' },
            ],
          },
        ],
      }),
    })
    expect(verdict.warnings).toStrictEqual([
      {
        contract: 'no-fix',
        severity: 'warning',
        path: '/frontmatter/description',
        message: 'Also long.',
        fix: 'Change the entry so that the rule "no-fix" passes: A title of at most 60 characters.',
      },
      {
        contract: 'no-fix',
        severity: 'warning',
        path: '/frontmatter/title',
        message: 'The title is long.',
        fix: 'Change the entry so that the rule "no-fix" passes: A title of at most 60 characters.',
      },
    ])
  })

  it('leaves a fix that has text as it is, spaces included', async () => {
    const verdict = await run({
      collection: collectionOf({
        contracts: [
          {
            id: 'has-fix',
            severity: 'error',
            description: 'Anything.',
            check: () => [{ path: '', message: 'm', fix: '  Shorten it.  ' }],
          },
        ],
      }),
    })
    expect(verdict.errors[0]?.fix).toBe('  Shorten it.  ')
  })
})

describe('every built-in contract', () => {
  it('gives every violation it can make a fix that is not empty', async () => {
    const { lookup } = fakeEntries([stored('es', 'draft', 'draft', 'edge-caching-guide')])
    const verdict = await run({
      phase: 'publish',
      collection: collectionOf({
        translationGroupField: 'translationGroup',
        components: { callout: { props: z.strictObject({ type: z.enum(['info', 'tip']) }) } },
        contracts: [
          contracts.translationPair(),
          contracts.internalLinksResolve(),
          contracts.imagesHaveAlt(),
        ],
      }),
      markdown: {
        ...markdownOf({ frontmatter: { title: 'A', description: 'B', tags: [] } }),
        extracted: {
          headings: [],
          words: 0,
          codeWords: 0,
          links: [
            {
              href: '/blog/draft/',
              kind: 'internal',
              line: 6,
              target: { collection: 'blog', locale: 'es', slug: 'draft' },
            },
          ],
          images: [{ src: '/a.png', alt: '', line: 7 }],
          components: [{ name: 'callout', props: { type: 'warn' }, line: 8 }],
          disallowed: [
            { kind: 'raw-html', name: 'script', line: 2 },
            { kind: 'unknown-component', name: 'youtub', line: 3 },
            { kind: 'disallowed-attribute', name: 'onerror', line: 4 },
            { kind: 'unsafe-url', name: 'javascript:alert(1)', line: 5 },
          ],
        },
      },
      entries: lookup,
    })

    const pair = await run({
      phase: 'publish',
      collection: collectionOf({
        translationGroupField: 'translationGroup',
        contracts: [contracts.translationPair()],
      }),
      entries: lookup,
    })
    const violations = [...verdict.errors, ...pair.errors]

    const ids = new Set(violations.map((violation) => violation.contract))
    expect([...ids].toSorted()).toStrictEqual(
      BUILT_IN_CONTRACT_IDS.filter((id) => !REFUSAL_CONTRACT_IDS.includes(id)).toSorted(),
    )
    for (const violation of violations) {
      expect(violation.fix.trim(), violation.contract).not.toBe('')
      expect(violation.message.trim(), violation.contract).not.toBe('')
    }
  })

  it('refuses to run outside runContracts, where it cannot know the site and the collection', async () => {
    const context: ContractContext<unknown> = {
      site: 'acme',
      collection: 'blog',
      locale: 'es',
      slug: 'a',
      entryId: null,
      phase: 'publish',
      frontmatter: {},
      markdown: markdownOf(),
      entries: NO_LOOKUPS,
    }
    await expect(contracts.translationPair().check(context)).rejects.toThrow(
      'The built-in contract translation-pair runs only through runContracts.',
    )
    expect(() => RAW_HTML.check(context)).toThrow(
      'The built-in contract raw-html runs only through runContracts.',
    )
    await expect(COMPONENTS.check(context)).rejects.toThrow(
      'The built-in contract components runs only through runContracts.',
    )
  })
})
