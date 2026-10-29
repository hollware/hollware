import { describe, expect, expectTypeOf, it } from 'vite-plus/test'

import * as config from '../../src/config/index.ts'
import type {
  CollectionDefinition,
  ComponentDefinition,
  ConfigProblem,
  DescribedSchema,
  HollwareConfig,
  ResolveConfig,
  ResolvedCollection,
  ResolvedConfig,
  ResolvedSite,
  SchemaOutput,
  SiteDefinition,
  SiteDescription,
} from '../../src/config/index.ts'
import * as contractsModule from '../../src/contracts/index.ts'
import type { ContractDescription } from '../../src/contracts/index.ts'
import * as operationsModule from '../../src/operations/index.ts'
import * as entry from './entry.ts'

describe('the config module', () => {
  it('exports these values, and the package entry re-exports them', () => {
    expect(Object.keys(config).sort()).toEqual([
      'AUDIT_RETENTION_MAX_DAYS',
      'AUDIT_RETENTION_MIN_DAYS',
      'AUTOMATIC_KINDS',
      'BACKUP_RETENTION_MAX_DAYS',
      'BACKUP_RETENTION_MIN_DAYS',
      'ConfigError',
      'DEFAULT_AUDIT',
      'DEFAULT_BACKUPS',
      'DEFAULT_MAX_MARKDOWN_BYTES',
      'DEFAULT_MEDIA',
      'INDEXNOW_KEY',
      'MAX_MARKDOWN_BYTES_CEILING',
      'MEDIA_FORMATS',
      'MEDIA_MAX_WIDTH',
      'MEDIA_MAX_WIDTHS',
      'MEDIA_MIN_WIDTH',
      'SITE_KEY_MAX_LENGTH',
      'SITE_KEY_PATTERN',
      'WORDS_PER_MINUTE',
      'admitsEmail',
      'defineCollection',
      'defineComponent',
      'defineConfig',
      'defineContract',
      'describeResolvedSite',
      'emailAddress',
      'isSiteKey',
      'resolveAdmin',
      'resolveAuth',
      'resolveConfig',
      'withAutomaticFields',
    ])
  })

  it('shares no name with the contracts or the operations, which the entry exports whole', () => {
    const names = [config, contractsModule, operationsModule].flatMap((module) =>
      Object.keys(module),
    )
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([])
    expect(Object.keys(entry).sort()).toEqual(names.toSorted())
  })

  it('exports these types', () => {
    expectTypeOf<ConfigProblem>().toEqualTypeOf<{
      readonly path: string
      readonly message: string
      readonly fix: string
    }>()
    expectTypeOf<SiteDescription['collections'][number]['contracts']>().toEqualTypeOf<
      ContractDescription[]
    >()
    expectTypeOf<SiteDescription['collections'][number]['sortByField']>().toEqualTypeOf<
      string | null
    >()
    expectTypeOf<ResolveConfig>().parameter(0).toEqualTypeOf<HollwareConfig>()
    expectTypeOf(config.resolveConfig).parameter(0).toBeUnknown()
    expectTypeOf(config.resolveConfig).returns.toEqualTypeOf<ResolvedConfig>()
    expectTypeOf(config.describeResolvedSite).returns.toEqualTypeOf<SiteDescription>()
    expectTypeOf<ResolvedConfig['sites']>().toEqualTypeOf<ReadonlyMap<string, ResolvedSite>>()
    expectTypeOf<ResolvedSite['collections']>().toEqualTypeOf<
      ReadonlyMap<string, ResolvedCollection>
    >()
    expectTypeOf<ResolvedCollection['components']>().toEqualTypeOf<
      ReadonlyMap<string, ComponentDefinition>
    >()
    expectTypeOf<SiteDefinition['collections']>().toEqualTypeOf<
      Readonly<Record<string, CollectionDefinition>>
    >()
    expectTypeOf<SchemaOutput<DescribedSchema>>().toBeUnknown()
    expectTypeOf(config.isSiteKey).toEqualTypeOf<(value: unknown) => value is string>()
    expectTypeOf(config.SITE_KEY_PATTERN).toEqualTypeOf<RegExp>()
    expectTypeOf<typeof config.SITE_KEY_MAX_LENGTH>().toEqualTypeOf<64>()
    expect(config.ConfigError.name).toBe('ConfigError')
  })

  it('has 512 KiB as the default size of a file and 768 KiB as the largest', () => {
    expect(config.DEFAULT_MAX_MARKDOWN_BYTES).toBe(524288)
    expect(config.MAX_MARKDOWN_BYTES_CEILING).toBe(786432)
  })
})
