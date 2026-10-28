export const name = '@hollware/core'

export * from './config/index.ts'
export * from './contracts/index.ts'
export * from './audit/index.ts'
export * from './structure/index.ts'
export { ERROR_CODES, HollwareError, type ErrorCode } from './errors.ts'
export { FORMER_PERSON, ID_PREFIXES, isId, newId, ulid, type IdPrefix } from './ids.ts'
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
export {
  canonicalMarkdown,
  COMARK_VERSION,
  formatMarkdown,
  type FormattedMarkdown,
  parseForEditing,
  PIPELINE_VERSION,
  processMarkdown,
  stringifyBody,
  renderHtml,
  safeDocument,
} from './markdown/index.ts'
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
export * from './media/index.ts'
export {
  canSignPreviews,
  makePreviewToken,
  PREVIEW_QUERY_PARAM,
  PREVIEW_SECRET_MIN_LENGTH,
  PREVIEW_TOKEN_PREFIX,
  PREVIEW_TTL_SECONDS,
  verifyPreviewToken,
  type PreviewCheck,
  type PreviewRefusal,
} from './preview.ts'
export {
  entryEvent,
  hollwareEvent,
  parseHollwareEvent,
  reviewEvent,
  siteEvent,
  type EntryEvent,
  type HollwareEvent,
  type ReviewEvent,
  type SiteEvent,
} from './events.ts'
export { CHUNK_LIMITS, CHUNKER_VERSION, chunksOf, type Chunk } from './search/chunks.ts'
export {
  entryTag,
  EVERY_LOCALE,
  groupTag,
  listTag,
  SITE_TAG,
  tagsOfChange,
  tagsOfSiteChange,
  tagsOfEntries,
  type TaggedEntry,
} from './cache.ts'
