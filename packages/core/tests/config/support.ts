import * as z from 'zod'

import { ConfigError, type ConfigProblem } from '../../src/config/config-error.ts'
import { resolveConfig } from '../../src/config/resolve.ts'
import type { DescribedSchema, ResolvedConfig, ResolvedSite } from '../../src/config/types.ts'

/**
 * What the tests of the config share. Configs are built as `unknown` objects, because the config
 * is user code that may break the types and `resolveConfig` is what looks at it.
 */

export type JsonSchema = Record<string, unknown>

/**
 * A Standard Schema with JSON Schema written by hand, standing for a validation library that
 * Hollware does not own: its JSON Schema is exactly what the test says, whatever Zod would write.
 */
export function schemaOf(input: JsonSchema, output: JsonSchema = input): DescribedSchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) => ({ value }),
      jsonSchema: { input: () => input, output: () => output },
    },
  }
}

/** Like `schemaOf`, and it counts how many times its JSON Schema was asked for. */
export function countingSchema(input: JsonSchema): {
  schema: DescribedSchema
  conversions: () => number
} {
  let conversions = 0
  const schema: DescribedSchema = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) => ({ value }),
      jsonSchema: {
        input: () => {
          conversions += 1
          return input
        },
        output: () => input,
      },
    },
  }
  return { schema, conversions: () => conversions }
}

/** A Standard Schema whose conversion to JSON Schema throws what the test gives. */
export function failingSchema(error: unknown): DescribedSchema {
  const fail = (): never => {
    throw error
  }
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) => ({ value }),
      jsonSchema: { input: fail, output: fail },
    },
  }
}

/** A library that breaks the types of Standard JSON Schema: what it converts to is the answer. */
export function brokenSchema(answer: unknown): DescribedSchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) => ({ value }),
      // @ts-expect-error -- the converter of this library answers with whatever the test says.
      jsonSchema: { input: () => answer, output: () => answer },
    },
  }
}

/** What running `run` throws, or `undefined` when it does not throw. */
export function thrownBy(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

/** What `resolveConfig` reports for a broken config; it fails the test when there is none. */
export function problemsOf(config: unknown): readonly ConfigProblem[] {
  const thrown = thrownBy(() => resolveConfig(config))
  if (!(thrown instanceof ConfigError)) {
    throw new Error(`resolveConfig should throw a ConfigError, and it gave ${String(thrown)}`)
  }
  return thrown.problems
}

/** The site of a resolved config, by its key. */
export function siteOf(resolved: ResolvedConfig, key: string): ResolvedSite {
  const site = resolved.sites.get(key)
  if (site === undefined) {
    throw new Error(`the resolved config has no site ${key}: ${[...resolved.sites.keys()].join()}`)
  }
  return site
}

/** The frontmatter of the collections below: a title, a date, tags and a translation group. */
export const frontmatter = z.object({
  title: z.string(),
  date: z.iso.date(),
  tags: z.array(z.string()),
  group: z.string(),
})

/** A collection that resolves as it is; `overrides` replace what the test is about. */
export function collectionWith(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: frontmatter,
    routes: { es: '/blog/:slug/', en: '/en/blog/:slug/' },
    ...overrides,
  }
}

/** A site that resolves as it is, with the one collection `blog`. */
export function siteWith(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    locales: ['es', 'en'],
    defaultLocale: 'es',
    collections: { blog: collectionWith() },
    ...overrides,
  }
}

/** A config with the one site `demo`. */
export function configWith(siteOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { sites: { demo: siteWith(siteOverrides) } }
}

/** A config whose only collection is `blog`, with these overrides. */
export function blogConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return configWith({ collections: { blog: collectionWith(overrides) } })
}

/** The path of the `blog` collection of the config above. */
export const BLOG = 'sites.demo.collections.blog'
