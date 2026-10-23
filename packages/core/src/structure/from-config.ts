import type { CollectionDefinition, HollwareConfig } from '../config/types.ts'
import { ConfigError, Problems } from '../config/config-error.ts'
import { itemPath, keyPath } from '../config/values.ts'
import type { SiteDefinitionInput } from './definition.ts'

type Collection = SiteDefinitionInput['collections'][string]

function toJsonSchema(schema: CollectionDefinition['schema']): Record<string, unknown> {
  return schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
}

function collectionOf(
  path: string,
  collection: CollectionDefinition,
  problems: Problems,
): Collection {
  const rules: NonNullable<Collection['rules']> = []
  ;(collection.contracts ?? []).forEach((contract, index) => {
    if (contract.rule === undefined) {
      problems.add(
        itemPath(keyPath(path, 'contracts'), index),
        `the contract "${contract.id}" is code of the config's own, which a definition cannot hold`,
        'Replace it with a rule of the catalog (contracts.fieldLength, contracts.fieldPattern, contracts.requiredToPublish, contracts.bannedWords, or the built-in ones), then deploy again.',
      )
      return
    }
    rules.push({
      rule: contract.rule.name,
      severity: contract.severity,
      params: { ...contract.rule.params },
      ...(contract.id === contract.rule.name ? {} : { id: contract.id }),
    })
  })
  return {
    schema: toJsonSchema(collection.schema),
    routes: { ...collection.routes },
    translationGroupField: collection.translations?.groupBy ?? null,
    tagsField: collection.tags ?? null,
    sortByField: collection.sortBy ?? null,
    automaticFields: { ...collection.automatic },
    components: Object.fromEntries(
      Object.entries(collection.components ?? {}).map(([name, component]) => [
        name,
        {
          props: toJsonSchema(component.props),
          ...(component.description === undefined ? {} : { description: component.description }),
          ...(component.example === undefined ? {} : { example: component.example }),
        },
      ]),
    ),
    rules,
    maxMarkdownBytes: collection.maxMarkdownBytes ?? null,
    styleGuide: collection.styleGuide ?? null,
  }
}

/** Every site of the config as a definition, or a `ConfigError` with what keeps one from moving. */
export function definitionsFromConfig(config: HollwareConfig): Record<string, SiteDefinitionInput> {
  const problems = new Problems()
  const definitions: Record<string, SiteDefinitionInput> = {}
  for (const [key, site] of Object.entries(config.sites ?? {})) {
    const path = keyPath('sites', key)
    definitions[key] = {
      locales: [...site.locales],
      defaultLocale: site.defaultLocale,
      url: site.url ?? null,
      styleGuide: site.styleGuide ?? null,
      cors: { origins: [...(site.cors?.origins ?? [])] },
      events: {
        webhooks: (site.events?.webhooks ?? []).map((webhook) => ({ ...webhook })),
        indexNow: site.events?.indexNow ?? null,
      },
      ...(site.audit === undefined
        ? {}
        : {
            audit: {
              ipAddresses: site.audit.ipAddresses ?? 'off',
              retentionDays: site.audit.retentionDays ?? null,
            },
          }),
      ...(site.backups === undefined ? {} : { backups: { ...site.backups } }),
      collections: Object.fromEntries(
        Object.entries(site.collections).map(([name, collection]) => [
          name,
          collectionOf(keyPath(keyPath(path, 'collections'), name), collection, problems),
        ]),
      ),
    }
  }
  if (problems.list.length > 0) throw new ConfigError(problems.list)
  return definitions
}
