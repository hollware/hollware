export const name = '@hollware/core'

export * from './config/index.ts'
export * from './contracts/index.ts'
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
export { COMARK_VERSION, PIPELINE_VERSION, processMarkdown, renderHtml } from './markdown/index.ts'
export * from './operations/index.ts'
export { isScope, SCOPES, type Scope } from './scopes.ts'
export {
  generatePersonalToken,
  generateReadToken,
  hashPersonalToken,
  isPersonalToken,
  isReadToken,
  PERSONAL_TOKEN_PREFIX,
  PERSONAL_TOKEN_TTL_DAYS,
  READ_TOKEN_PREFIX,
} from './tokens.ts'
export * from './webhooks.ts'
