export const name = '@hollware/core'

export { defineCollection, defineComponent, defineConfig, defineContract } from './config/define.ts'
export type {
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
} from './config/types.ts'
export type {
  AcknowledgedWarning,
  Contract,
  ContractContext,
  ContractFinding,
  EntryFacts,
  EntryLookup,
  EntryRef,
  Phase,
  Severity,
  Verdict,
  Violation,
} from './contracts/types.ts'
export { ERROR_CODES, HollwareError, type ErrorCode } from './errors.ts'
export { ID_PREFIXES, isId, newId, ulid, type IdPrefix } from './ids.ts'
export type {
  ComponentUse,
  DisallowedMarker,
  EntryDocument,
  ExtractedContent,
  Heading,
  ImageRef,
  LinkRef,
  LinkTarget,
  ProcessedMarkdown,
  ProcessMarkdown,
  ProcessMarkdownOptions,
  ProcessResult,
  RenderHtml,
} from './markdown/types.ts'
export * from './operations/index.ts'
export { isScope, SCOPES, type Scope } from './scopes.ts'
export {
  generatePersonalToken,
  hashPersonalToken,
  isPersonalToken,
  PERSONAL_TOKEN_PREFIX,
  PERSONAL_TOKEN_TTL_DAYS,
} from './tokens.ts'
