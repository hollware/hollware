import { describe, expect, it } from 'vite-plus/test'

import { contracts, type Severity } from '../../src/contracts/index.ts'
import type { LinkRef } from '../../src/markdown/types.ts'
import {
  collectionOf,
  fakeEntries,
  markdownOf,
  run,
  type RunParts,
  stored,
  type StoredEntry,
} from './support.ts'

// Fails when: `internal-links-resolve` runs outside the publish phase, or asks the store about
// links more than once, about the same target twice, about the entry itself or about a link that
// is not an internal one, or at all when there is nothing to ask; stops accepting a published
// entry or stops rejecting a missing, a draft or a scheduled one; stops saying which link, which
// entry and what to do; stops pointing at the line of the link; or ignores the severity it is given.

function link(slug: string, line: number, locale = 'es', collection = 'blog'): LinkRef {
  return {
    href: `/${collection}/${slug}/`,
    kind: 'internal',
    line,
    target: { collection, locale, slug },
  }
}

interface LinkParts extends RunParts {
  readonly links?: readonly LinkRef[]
  readonly severity?: Severity
}

async function runLinks(
  stores: readonly StoredEntry[],
  { links = [], severity, ...parts }: LinkParts = {},
) {
  const { lookup, calls } = fakeEntries(stores)
  const verdict = await run({
    phase: 'publish',
    collection: collectionOf({
      contracts: [contracts.internalLinksResolve(severity === undefined ? {} : { severity })],
    }),
    markdown: markdownOf({ links }),
    entries: lookup,
    ...parts,
  })
  return { verdict, calls }
}

function error(href: string, entry: string, why: string, fix: string, line: number) {
  return {
    contract: 'internal-links-resolve',
    severity: 'error',
    path: '/body',
    message: `The link "${href}" points at the entry ${entry}, ${why}.`,
    fix,
    line,
  }
}

describe('the internal-links-resolve contract', () => {
  it('passes links that point at published entries, with one question to the store', async () => {
    const { verdict, calls } = await runLinks(
      [stored('es', 'one'), stored('es', 'two'), stored('en', 'one')],
      { links: [link('one', 3), link('two', 5), link('one', 7, 'en')] },
    )
    expect(verdict.errors).toStrictEqual([])
    expect(verdict.ok).toBe(true)
    expect(calls).toStrictEqual([
      {
        method: 'lookupMany',
        refs: [
          { collection: 'blog', locale: 'es', slug: 'one' },
          { collection: 'blog', locale: 'es', slug: 'two' },
          { collection: 'blog', locale: 'en', slug: 'one' },
        ],
      },
    ])
  })

  it('rejects an entry that does not exist, is a draft or is scheduled, and says what to do', async () => {
    const { verdict } = await runLinks(
      [stored('es', 'draft', 'draft'), stored('es', 'later', 'scheduled')],
      {
        links: [link('missing', 3), link('draft', 5), link('later', 8)],
      },
    )
    expect(verdict.errors).toStrictEqual([
      error(
        '/blog/missing/',
        'blog/es/missing',
        'which does not exist',
        'Create and publish the entry blog/es/missing, point the link at an entry that is published, or remove the link.',
        3,
      ),
      error(
        '/blog/draft/',
        'blog/es/draft',
        'which is not published yet (draft)',
        'Publish the entry blog/es/draft first, point the link at an entry that is published, or remove the link.',
        5,
      ),
      error(
        '/blog/later/',
        'blog/es/later',
        'which is not published yet (scheduled)',
        'Publish the entry blog/es/later first, point the link at an entry that is published, or remove the link.',
        8,
      ),
    ])
    expect(verdict.ok).toBe(false)
  })

  it('asks about all the targets in one call, each target once, in the order they first appear', async () => {
    const { verdict, calls } = await runLinks([stored('es', 'b')], {
      links: [link('a', 2), link('b', 4), link('a', 6), link('c', 8)],
    })
    expect(calls).toStrictEqual([
      {
        method: 'lookupMany',
        refs: [
          { collection: 'blog', locale: 'es', slug: 'a' },
          { collection: 'blog', locale: 'es', slug: 'b' },
          { collection: 'blog', locale: 'es', slug: 'c' },
        ],
      },
    ])
    // Both links to the missing target are reported, each on its own line.
    expect(verdict.errors.map((violation) => [violation.line, violation.message])).toStrictEqual([
      [2, 'The link "/blog/a/" points at the entry blog/es/a, which does not exist.'],
      [6, 'The link "/blog/a/" points at the entry blog/es/a, which does not exist.'],
      [8, 'The link "/blog/c/" points at the entry blog/es/c, which does not exist.'],
    ])
  })

  it('tells two targets apart even when their names run together to the same text', async () => {
    const { calls } = await runLinks([], {
      links: [link('x', 3, 'bc', 'a'), link('x', 4, 'c', 'ab')],
    })
    expect(calls).toStrictEqual([
      {
        method: 'lookupMany',
        refs: [
          { collection: 'a', locale: 'bc', slug: 'x' },
          { collection: 'ab', locale: 'c', slug: 'x' },
        ],
      },
    ])
  })

  it('clips the name of an entry that is very long, in the message and the fix', async () => {
    const slug = 'x'.repeat(200)
    const { verdict } = await runLinks([], { links: [link(slug, 3)] })
    const entry = `the entry blog/es/${'x'.repeat(72)}…`
    expect(verdict.errors[0]?.message).toBe(
      `The link "/blog/${'x'.repeat(74)}…" points at ${entry}, which does not exist.`,
    )
    expect(verdict.errors[0]?.fix).toBe(
      `Create and publish ${entry}, point the link at an entry that is published, or remove the link.`,
    )
  })

  it('lets an entry link to itself, even a draft that no row holds yet, and does not ask about it', async () => {
    const { verdict, calls } = await runLinks([], {
      slug: 'edge-caching-guide',
      links: [link('edge-caching-guide', 4)],
    })
    expect(verdict.errors).toStrictEqual([])
    expect(calls).toStrictEqual([])
  })

  it('asks about the other locale of the entry itself, which is another entry', async () => {
    const { verdict, calls } = await runLinks([], {
      slug: 'edge-caching-guide',
      links: [link('edge-caching-guide', 4, 'en')],
    })
    expect(calls).toHaveLength(1)
    expect(verdict.errors.map((violation) => violation.message)).toStrictEqual([
      'The link "/blog/edge-caching-guide/" points at the entry blog/en/edge-caching-guide, which does not exist.',
    ])
  })

  it('asks about an entry of another collection that has the same locale and slug', async () => {
    const { verdict, calls } = await runLinks([], {
      slug: 'edge-caching-guide',
      links: [link('edge-caching-guide', 4, 'es', 'docs')],
    })
    expect(calls).toStrictEqual([
      {
        method: 'lookupMany',
        refs: [{ collection: 'docs', locale: 'es', slug: 'edge-caching-guide' }],
      },
    ])
    expect(verdict.errors.map((violation) => violation.message)).toStrictEqual([
      'The link "/docs/edge-caching-guide/" points at the entry docs/es/edge-caching-guide, which does not exist.',
    ])
  })

  it('leaves out the links that are not internal and asks nothing when none is', async () => {
    const { verdict, calls } = await runLinks([], {
      links: [
        { href: '/about/', kind: 'site', line: 1 },
        { href: '#intro', kind: 'anchor', line: 2 },
        { href: 'https://example.com/', kind: 'external', line: 3 },
        // An internal link with no target cannot be looked up.
        { href: '/blog/x/', kind: 'internal', line: 4 },
        // Only an internal link names an entry, whatever else a link carries.
        {
          href: '/blog/x/',
          kind: 'site',
          line: 5,
          target: { collection: 'blog', locale: 'es', slug: 'x' },
        },
      ],
    })
    expect(verdict.errors).toStrictEqual([])
    expect(calls).toStrictEqual([])
  })

  it('does not run in the write phase', async () => {
    const { verdict, calls } = await runLinks([], {
      phase: 'write',
      links: [link('missing', 3)],
    })
    expect(verdict.errors).toStrictEqual([])
    expect(calls).toStrictEqual([])
  })

  it('runs while the frontmatter does not pass the schema, which it does not read', async () => {
    const { verdict, calls } = await runLinks([], {
      links: [link('missing', 3)],
      markdown: markdownOf({ frontmatter: {}, links: [link('missing', 3)] }),
    })
    expect(verdict.errors.map((violation) => violation.contract)).toStrictEqual([
      'schema',
      'schema',
      'schema',
      'internal-links-resolve',
    ])
    expect(calls).toHaveLength(1)
  })

  it('is a warning when it is given that severity', async () => {
    const { verdict } = await runLinks([], { links: [link('missing', 3)], severity: 'warning' })
    expect(verdict.errors).toStrictEqual([])
    expect(verdict.warnings.map((violation) => violation.severity)).toStrictEqual(['warning'])
    expect(verdict.ok).toBe(true)
  })
})
