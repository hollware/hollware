export const name = '@hollware/react'

// The server helpers know no framework, so they live in `@hollware/client`, shared with
// `@hollware/vue`; this package re-exports them so a React app imports one package.
export {
  createHollware,
  hollwareBinding,
  isPreviewRequest,
  PREVIEW_COOKIE,
  previewCookieClear,
  previewHeaders,
  previewRedirect,
  type EntryAnswer,
  type EntryPage,
  type GetEntryOptions,
  type Hollware,
  type HollwareOptions,
  type HollwareReader,
  type ListEntriesOptions,
  type PageDocument,
  type PageEntry,
  type PageImage,
  type PageSummary,
  type ReaderOptions,
  type Translation,
} from '@hollware/client'
export { HollwareContent, type HollwareContentProps } from './content.tsx'
