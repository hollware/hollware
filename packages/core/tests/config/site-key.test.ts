import { describe, expect, expectTypeOf, it } from 'vite-plus/test'

import { ConfigError } from '../../src/config/config-error.ts'
import { resolveConfig } from '../../src/config/resolve.ts'
import { isSiteKey, SITE_KEY_MAX_LENGTH, SITE_KEY_PATTERN } from '../../src/config/site-key.ts'
import { collectionWith, siteWith, thrownBy } from './support.ts'

const accepted = [
  'blog',
  'a',
  '0',
  '2026',
  '1demo',
  'docs-2',
  'my-site',
  'a-b-c',
  'a'.repeat(64),
  '9'.repeat(64),
  `${'a'.repeat(31)}-${'b'.repeat(32)}`,
]

const refused = [
  '',
  '-',
  '-a',
  'a-',
  'a--b',
  'A',
  'Demo',
  'my_site',
  'my site',
  'démo',
  'a.b',
  'a/b',
  'a\nb',
  'a\n',
  '\na',
  ' a',
  'a ',
  'a'.repeat(65),
  `${'a'.repeat(64)}-b`,
]

describe('the rule of a site key', () => {
  it('is the pattern and the length of the CLI', () => {
    expect(SITE_KEY_PATTERN.source).toBe('^[a-z0-9]+(?:-[a-z0-9]+)*$')
    expect(SITE_KEY_PATTERN.flags).toBe('')
    expect(SITE_KEY_MAX_LENGTH).toBe(64)
  })

  it('accepts lowercase letters and digits joined by single hyphens, up to 64 characters', () => {
    expect(accepted.map((key) => isSiteKey(key))).toEqual(accepted.map(() => true))
  })

  it('refuses everything else', () => {
    expect(refused.map((key) => isSiteKey(key))).toEqual(refused.map(() => false))
  })

  it('refuses what is no string, even when it reads like a key', () => {
    const values = [
      undefined,
      null,
      5,
      true,
      10n,
      ['a'],
      { toString: () => 'a' },
      Symbol('a'),
      () => 'a',
    ]
    expect(values.map((value) => isSiteKey(value))).toEqual(values.map(() => false))
  })

  it('narrows what it accepts to a string', () => {
    expectTypeOf(isSiteKey).toEqualTypeOf<(value: unknown) => value is string>()
    expectTypeOf<typeof SITE_KEY_MAX_LENGTH>().toEqualTypeOf<64>()
    const value: unknown = 'blog'
    expect(isSiteKey(value) ? value.toUpperCase() : null).toBe('BLOG')
  })
})

describe('resolveConfig and the key of a site', () => {
  it('takes every key that isSiteKey accepts', () => {
    const outcomes = accepted.map((key) =>
      thrownBy(() => resolveConfig({ sites: { [key]: siteWith() } })),
    )
    expect(outcomes).toEqual(accepted.map(() => undefined))
  })

  it('refuses every key that isSiteKey refuses, with one problem that names it', () => {
    const problems = refused.map((key) => {
      const thrown = thrownBy(() => resolveConfig({ sites: { [key]: siteWith() } }))
      return thrown instanceof ConfigError
        ? thrown.problems.map((problem) => problem.message)
        : thrown
    })
    expect(problems).toEqual(
      refused.map((key) => [`${JSON.stringify(key)} is not a valid site key`]),
    )
  })

  it('keeps the rule of collection names apart: a name that starts with a digit is no collection', () => {
    const thrown = thrownBy(() =>
      resolveConfig({
        sites: { '1demo': siteWith({ collections: { '1blog': collectionWith() } }) },
      }),
    )
    expect(thrown instanceof ConfigError ? thrown.problems : thrown).toEqual([
      {
        path: 'sites.1demo.collections.1blog',
        message: '"1blog" is not a valid collection name',
        fix: 'Use lowercase letters, digits and hyphens, starting with a letter, at most 63 characters, such as "blog".',
      },
    ])
  })
})
