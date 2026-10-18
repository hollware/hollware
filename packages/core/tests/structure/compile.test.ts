import * as z from 'zod'
import { describe, expect, it } from 'vite-plus/test'
import { ConfigError } from '../../src/config/config-error.ts'
import { resolveConfig } from '../../src/config/resolve.ts'
import type { HollwareConfig, ResolvedConfig } from '../../src/config/types.ts'
import { contracts, runContracts, type Phase } from '../../src/contracts/index.ts'
import { compileSites } from '../../src/structure/compile.ts'
import { definitionsFromConfig } from '../../src/structure/from-config.ts'
import { markdownOf, NO_LOOKUPS } from '../contracts/support.ts'

// Fails when: a site's definition (src/structure/compile.ts) stops compiling into the same
// resolved site its 0.x config resolves to (src/structure/from-config.ts): the same rules, with
// their parameters, the same verdict on an entry and the same hash of the rules, so that moving a
// deployment keeps every stored verdict current, and the backup setting of the site; or stops refusing, with each problem at its
// path, a rule the catalog lacks, parameters the rule does not take, a schema that is not of an
// object, a definition of the wrong shape, or a contract of the config's own code; or a
// deployment with no site stops compiling to none.

const CONFIG: HollwareConfig = {
  sites: {
    blog: {
      locales: ['es', 'en'],
      defaultLocale: 'es',
      url: 'https://blog.example.com',
      backups: { enabled: false, retentionDays: 7 },
      collections: {
        posts: {
          schema: z.object({
            title: z.string().min(1),
            seoTitle: z.string().max(60).optional(),
            description: z.string().min(1).max(160),
            tags: z.array(z.string().min(1)).min(1),
            translationGroup: z.string().min(1),
          }),
          routes: { es: '/blog/:slug/', en: '/en/blog/:slug/' },
          translations: { groupBy: 'translationGroup' },
          tags: 'tags',
          contracts: [
            contracts.translationPair({ severity: 'warning' }),
            contracts.imagesHaveAlt(),
            contracts.fieldLength(
              { field: 'title', max: 60, unless: 'seoTitle' },
              { severity: 'warning', id: 'seo-title-length' },
            ),
          ],
          styleGuide: 'Short.',
        },
      },
    },
  },
}

function verdictOf(config: ResolvedConfig, title: string, phase: Phase) {
  const site = config.sites.get('blog')
  const collection = site?.collections.get('posts')
  if (site === undefined || collection === undefined) throw new Error('no blog/posts')
  return runContracts({
    site,
    collection,
    locale: 'es',
    slug: 'hola',
    entryId: null,
    phase,
    markdown: markdownOf({
      frontmatter: { title, description: 'D', tags: ['a'], translationGroup: 'hola' },
      images: [{ src: '/a.png', alt: '', line: 3 }],
    }),
    entries: { ...NO_LOOKUPS, translations: () => Promise.resolve([]) },
  })
}

describe('a 0.x config moved to a definition', () => {
  const definitions = definitionsFromConfig(CONFIG)

  it('keeps the backup setting of the site', () => {
    const compiled = compileSites(JSON.parse(JSON.stringify(definitions)))
    expect(compiled.sites.get('blog')?.backups).toEqual({ enabled: false, retentionDays: 7 })
    expect(resolveConfig(CONFIG).sites.get('blog')?.backups).toEqual({
      enabled: false,
      retentionDays: 7,
    })
  })

  it('keeps the rules with their parameters, and the id given to one', () => {
    expect(definitions['blog']?.collections['posts']?.rules).toEqual([
      { rule: 'translation-pair', severity: 'warning', params: {} },
      { rule: 'images-have-alt', severity: 'error', params: {} },
      {
        rule: 'field-length',
        severity: 'warning',
        params: { field: 'title', max: 60, unless: 'seoTitle' },
        id: 'seo-title-length',
      },
    ])
  })

  it('gives the same verdict and hash as the config, once stored as JSON and compiled', async () => {
    const stored: Record<string, unknown> = JSON.parse(JSON.stringify(definitions))
    const compiled = compileSites(stored)
    const resolved = resolveConfig(CONFIG)
    const long = 'A title that runs on and on, well past what a search engine shows'
    for (const phase of ['write', 'publish'] as const) {
      expect(await verdictOf(compiled, long, phase)).toEqual(await verdictOf(resolved, long, phase))
    }
    const verdict = await verdictOf(compiled, long, 'publish')
    expect([...verdict.errors, ...verdict.warnings].map((v) => v.contract).sort()).toEqual([
      'images-have-alt',
      'seo-title-length',
      'translation-pair',
    ])
  })

  it('refuses a contract of the config’s own code', () => {
    const custom: HollwareConfig = {
      sites: {
        blog: {
          locales: ['es'],
          defaultLocale: 'es',
          collections: {
            posts: {
              schema: z.object({ title: z.string() }),
              routes: { es: '/:slug/' },
              contracts: [{ id: 'mine', severity: 'error', description: 'Mine.', check: () => [] }],
            },
          },
        },
      },
    }
    let problems: readonly { path: string }[] = []
    try {
      definitionsFromConfig(custom)
    } catch (error) {
      if (error instanceof ConfigError) problems = error.problems
    }
    expect(problems.map((problem) => problem.path)).toEqual([
      'sites.blog.collections.posts.contracts[0]',
    ])
  })
})

describe('compileSites', () => {
  it('hashes the parameters of a rule, so that changing one makes stored verdicts stale', async () => {
    const withMax = (max: number) => {
      const stored: Record<string, unknown> = JSON.parse(
        JSON.stringify(definitionsFromConfig(CONFIG)),
      )
      const blog = stored['blog']
      if (typeof blog !== 'object' || blog === null) throw new Error('no blog')
      const rules = Reflect.get(Reflect.get(Reflect.get(blog, 'collections'), 'posts'), 'rules')
      Reflect.set(Reflect.get(rules, 2), 'params', { field: 'title', max, unless: 'seoTitle' })
      return compileSites(stored)
    }
    const hashOf = async (max: number) =>
      (await verdictOf(withMax(max), 'Hola', 'write')).contractsHash
    expect(await hashOf(60)).toBe(await hashOf(60))
    expect(await hashOf(60)).not.toBe(await hashOf(70))
  })

  it('compiles no site to none', () => {
    expect(compileSites({}).sites.size).toBe(0)
  })

  it('refuses every problem of a definition at once, each at its path', () => {
    const definition = {
      locales: ['en'],
      defaultLocale: 'en',
      collections: {
        posts: {
          schema: { type: 'string' },
          routes: { en: '/:slug/' },
          rules: [{ rule: 'no-such-rule' }, { rule: 'field-length', params: { field: 'title' } }],
        },
      },
    }
    let problems: readonly { path: string }[] = []
    try {
      compileSites({ blog: definition, broken: { locales: 'en' } })
    } catch (error) {
      if (error instanceof ConfigError) problems = error.problems
    }
    expect(problems.map((problem) => problem.path)).toEqual([
      'sites.blog.collections.posts.schema',
      'sites.blog.collections.posts.rules[0].rule',
      'sites.blog.collections.posts.rules[1].params',
      'sites.broken.locales',
      'sites.broken.defaultLocale',
      'sites.broken.collections',
    ])
  })
})
