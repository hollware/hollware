import * as z from 'zod'
import { ConfigError, Problems } from '../config/config-error.ts'
import { resolveConfig } from '../config/resolve.ts'
import type {
  CollectionDefinition,
  ComponentDefinition,
  ResolvedConfig,
  SiteDefinition,
} from '../config/types.ts'
import { keyPath, itemPath } from '../config/values.ts'
import { catalogRule } from '../contracts/catalog.ts'
import type { Contract } from '../contracts/types.ts'
import {
  siteDefinitionData,
  type CollectionDefinitionData,
  type SiteDefinitionData,
} from './definition.ts'
import { describedSchemaOf } from './json-schema.ts'

/**
 * The sites of a deployment from their definitions in D1 (ADR-033), resolved as a config is: the
 * same checks, the same defaults, the same `ResolvedSite` the rest of the server reads. It throws
 * one `ConfigError` with every problem, each at its path (`sites.blog.collections.posts.rules[0]`)
 * and with its fix, so that an operation that changes the structure answers what to change.
 */

function isObjectSchema(schema: Readonly<Record<string, unknown>>): boolean {
  return schema['type'] === 'object'
}

function compileCollection(
  path: string,
  collection: CollectionDefinitionData,
  problems: Problems,
): CollectionDefinition {
  if (!isObjectSchema(collection.schema)) {
    problems.add(
      keyPath(path, 'schema'),
      'the schema of the frontmatter is not of an object',
      'Give a JSON Schema with "type": "object" and the fields under "properties".',
    )
  }
  const components: Record<string, ComponentDefinition> = {}
  for (const [name, component] of Object.entries(collection.components)) {
    components[name] = {
      props: describedSchemaOf(component.props),
      ...(component.description === undefined ? {} : { description: component.description }),
      ...(component.example === undefined ? {} : { example: component.example }),
    }
  }
  const contracts: Contract<unknown>[] = []
  collection.rules.forEach((rule, index) => {
    const at = itemPath(keyPath(path, 'rules'), index)
    const entry = catalogRule(rule.rule)
    if (entry === undefined) {
      problems.add(
        keyPath(at, 'rule'),
        `there is no rule "${rule.rule}" in the catalog`,
        'Use the name of a rule that describe_site lists in its catalog.',
      )
      return
    }
    const params = entry.params.safeParse(rule.params)
    if (!params.success) {
      problems.add(
        keyPath(at, 'params'),
        `the parameters of "${rule.rule}" are not valid: ${z.prettifyError(params.error).replaceAll('\n', ' ')}`,
        'Give the parameters as the catalog describes them for this rule.',
      )
      return
    }
    contracts.push(entry.make(params.data, rule.severity, rule.id))
  })
  return {
    schema: describedSchemaOf(collection.schema),
    routes: collection.routes,
    ...(collection.translationGroupField === null
      ? {}
      : { translations: { groupBy: collection.translationGroupField } }),
    ...(collection.tagsField === null ? {} : { tags: collection.tagsField }),
    ...(collection.sortByField === null ? {} : { sortBy: collection.sortByField }),
    components,
    contracts,
    ...(collection.maxMarkdownBytes === null
      ? {}
      : { maxMarkdownBytes: collection.maxMarkdownBytes }),
    ...(collection.styleGuide === null ? {} : { styleGuide: collection.styleGuide }),
  }
}

function compileSite(path: string, site: SiteDefinitionData, problems: Problems): SiteDefinition {
  const collections: Record<string, CollectionDefinition> = {}
  for (const [name, collection] of Object.entries(site.collections)) {
    collections[name] = compileCollection(
      keyPath(keyPath(path, 'collections'), name),
      collection,
      problems,
    )
  }
  const [first, ...rest] = site.locales
  return {
    locales: [first ?? '', ...rest],
    defaultLocale: site.defaultLocale,
    collections,
    ...(site.url === null ? {} : { url: site.url }),
    ...(site.styleGuide === null ? {} : { styleGuide: site.styleGuide }),
    cors: { origins: site.cors.origins },
    events: {
      webhooks: site.events.webhooks,
      ...(site.events.indexNow === null ? {} : { indexNow: site.events.indexNow }),
    },
  }
}

/** The definitions of the sites, read from D1 as JSON, checked and resolved. */
export function compileSites(definitions: Readonly<Record<string, unknown>>): ResolvedConfig {
  const problems = new Problems()
  const sites: Record<string, SiteDefinition> = {}
  for (const [key, raw] of Object.entries(definitions)) {
    const path = keyPath('sites', key)
    const parsed = siteDefinitionData.safeParse(raw)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.add(
          [path, ...issue.path.map(String)].join('.'),
          issue.message.replace(/\.$/, ''),
          'Write the definition as describe_site shows one.',
        )
      }
      continue
    }
    sites[key] = compileSite(path, parsed.data, problems)
  }
  if (problems.list.length > 0) throw new ConfigError(problems.list)
  // A deployment starts with no site: its owner makes the first one (ADR-033).
  if (Object.keys(sites).length === 0) {
    return { sites: new Map(), auth: { dynamicClientRegistration: false } }
  }
  return resolveConfig({ sites })
}
