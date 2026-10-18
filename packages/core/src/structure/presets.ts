import type { CollectionDefinitionData, SiteDefinitionData } from './definition.ts'

/**
 * Where a new collection or site starts (ADR-033), in the admin and in `hollware init`: a blog, docs, or nothing. Each is a definition
 * the person then changes, with a route per locale that the collection's name begins.
 */

type Definition = SiteDefinitionData
type CollectionDefinition = CollectionDefinitionData

export const PRESETS = ['blog', 'docs', 'empty'] as const

export type Preset = (typeof PRESETS)[number]

/** The path of an entry in each locale: the default one at the root, the others under theirs. */
export function routesFor(
  name: string,
  locales: readonly string[],
  defaultLocale: string,
): Record<string, string> {
  return Object.fromEntries(
    locales.map((locale) => [
      locale,
      locale === defaultLocale ? `/${name}/:slug/` : `/${locale}/${name}/:slug/`,
    ]),
  )
}

export function collectionPreset(
  preset: Preset,
  name: string,
  locales: readonly string[],
  defaultLocale: string,
): CollectionDefinition {
  const translated = locales.length > 1
  const base = {
    routes: routesFor(name, locales, defaultLocale),
    translationGroupField: null,
    tagsField: null,
    sortByField: null,
    components: {},
    rules: [],
    maxMarkdownBytes: null,
    styleGuide: null,
  }
  switch (preset) {
    case 'empty':
      return {
        ...base,
        schema: {
          type: 'object',
          properties: { title: { type: 'string', minLength: 1 } },
          required: ['title'],
        },
      }
    case 'blog':
      return {
        ...base,
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1 },
            description: { type: 'string', minLength: 1, maxLength: 160 },
            date: { type: 'string', format: 'date' },
            tags: { type: 'array', items: { type: 'string', minLength: 1 } },
            ...(translated ? { translationGroup: { type: 'string', minLength: 1 } } : {}),
          },
          required: ['title', 'description', 'date', ...(translated ? ['translationGroup'] : [])],
        },
        translationGroupField: translated ? 'translationGroup' : null,
        tagsField: 'tags',
        sortByField: 'date',
        rules: [
          { rule: 'images-have-alt', severity: 'error', params: {} },
          { rule: 'internal-links-resolve', severity: 'warning', params: {} },
          ...(translated
            ? [{ rule: 'translation-pair', severity: 'warning' as const, params: {} }]
            : []),
        ],
      }
    case 'docs':
      return {
        ...base,
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 70 },
            description: { type: 'string', minLength: 1, maxLength: 160 },
            order: { type: 'integer', minimum: 0 },
          },
          required: ['title', 'description'],
        },
        rules: [
          { rule: 'images-have-alt', severity: 'error', params: {} },
          { rule: 'internal-links-resolve', severity: 'warning', params: {} },
        ],
      }
  }
}

/** A new site: its locales, and one collection from the preset. */
export function sitePreset(
  preset: Preset,
  locales: readonly string[],
  defaultLocale: string,
): Definition {
  // A site has at least one collection: an empty one starts with pages of a title alone.
  const name = preset === 'empty' ? 'pages' : preset
  const collections = { [name]: collectionPreset(preset, name, locales, defaultLocale) }
  return {
    locales: [...locales],
    defaultLocale,
    url: null,
    styleGuide: null,
    cors: { origins: [] },
    events: { webhooks: [], indexNow: null },
    audit: { ipAddresses: 'off', retentionDays: null },
    backups: { enabled: true, retentionDays: 30 },
    media: { format: 'webp', quality: 85, maxWidth: 2400, widths: [640, 1280] },
    collections,
  }
}
