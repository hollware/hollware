import * as z from 'zod'

import { ConfigError, type ConfigProblem } from '../../src/config/config-error.ts'
import { resolveConfig } from '../../src/config/resolve.ts'
import type { DescribedSchema, ResolvedConfig, ResolvedSite } from '../../src/config/types.ts'

export type JsonSchema = Record<string, unknown>

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

export function thrownBy(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

export function problemsOf(config: unknown): readonly ConfigProblem[] {
  const thrown = thrownBy(() => resolveConfig(config))
  if (!(thrown instanceof ConfigError)) {
    throw new Error(`resolveConfig should throw a ConfigError, and it gave ${String(thrown)}`)
  }
  return thrown.problems
}

export function siteOf(resolved: ResolvedConfig, key: string): ResolvedSite {
  const site = resolved.sites.get(key)
  if (site === undefined) {
    throw new Error(`the resolved config has no site ${key}: ${[...resolved.sites.keys()].join()}`)
  }
  return site
}

export const frontmatter = z.object({
  title: z.string(),
  date: z.iso.date(),
  tags: z.array(z.string()),
  group: z.string(),
})

export function collectionWith(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: frontmatter,
    routes: { es: '/blog/:slug/', en: '/en/blog/:slug/' },
    ...overrides,
  }
}

export function siteWith(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    locales: ['es', 'en'],
    defaultLocale: 'es',
    collections: { blog: collectionWith() },
    ...overrides,
  }
}

export function configWith(siteOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { sites: { demo: siteWith(siteOverrides) } }
}

export function blogConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return configWith({ collections: { blog: collectionWith(overrides) } })
}

export const BLOG = 'sites.demo.collections.blog'
