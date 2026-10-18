export const name = '@hollware/vue'

// The server helpers know no framework, so they live in `@hollware/client`, shared with
// `@hollware/react`; this package re-exports them so a Vue app imports one package.
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
export { HollwareContent } from './content.ts'
export {
  createHollwarePlugin,
  provideHollware,
  useHollwareEntries,
  useHollwareEntry,
  type HollwareState,
} from './composables.ts'
