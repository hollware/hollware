export const name = '@hollware/react'

export { hollwareBinding, PREVIEW_COOKIE, type HollwareReader } from '@hollware/client'
export {
  createHollware,
  type EntryAnswer,
  type EntryPage,
  type GetEntryOptions,
  type Hollware,
  type HollwareOptions,
  type ListEntriesOptions,
  type PageDocument,
  type PageEntry,
  type PageSummary,
  type ReaderOptions,
  type Translation,
} from './hollware.ts'
export { isPreviewRequest, previewCookieClear, previewHeaders, previewRedirect } from './preview.ts'
export { HollwareContent, type HollwareContentProps } from './content.tsx'
