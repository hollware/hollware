export { defineCollection, defineComponent, defineConfig, defineContract } from './define.ts'
export type {
  AuthDefinition,
  ResolvedAuth,
  ResolvedAudit,
  ResolvedBackups,
  CollectionDefinition,
  ComponentDefinition,
  DescribedSchema,
  HollwareConfig,
  ResolveConfig,
  ResolvedCollection,
  ResolvedConfig,
  ResolvedSite,
  SchemaOutput,
  SiteDefinition,
} from './types.ts'
export { ConfigError, type ConfigProblem } from './config-error.ts'
export { INDEXNOW_KEY } from './events.ts'
export { AUDIT_RETENTION_MAX_DAYS, AUDIT_RETENTION_MIN_DAYS, DEFAULT_AUDIT } from './audit.ts'
export { BACKUP_RETENTION_MAX_DAYS, BACKUP_RETENTION_MIN_DAYS, DEFAULT_BACKUPS } from './backups.ts'
export {
  DEFAULT_MEDIA,
  MEDIA_FORMATS,
  MEDIA_MAX_WIDTH,
  MEDIA_MAX_WIDTHS,
  MEDIA_MIN_WIDTH,
} from './media.ts'
export {
  AUTOMATIC_KINDS,
  WORDS_PER_MINUTE,
  withAutomaticFields,
  type AutomaticFacts,
  type AutomaticField,
  type AutomaticKind,
} from './automatic.ts'
export { DEFAULT_MAX_MARKDOWN_BYTES, MAX_MARKDOWN_BYTES_CEILING } from './constants.ts'
export { describeResolvedSite, type SiteDescription } from './describe.ts'
export { resolveConfig } from './resolve.ts'
export { isSiteKey, SITE_KEY_MAX_LENGTH, SITE_KEY_PATTERN } from './site-key.ts'
