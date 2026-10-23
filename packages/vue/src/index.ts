export const name = '@hollware/vue'

export {
  createHollware,
  hollwareBinding,
  imageOf,
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
  type ImageAttributes,
  type ListEntriesOptions,
  type PageDocument,
  type PageEntry,
  type PageImage,
  type PageSummary,
  type ReaderOptions,
  type Translation,
} from '@hollware/client'
export { HollwareContent } from './content.ts'
export { HollwareImage } from './image.ts'
export {
  createHollwarePlugin,
  provideHollware,
  useHollwareEntries,
  useHollwareEntry,
  type HollwareState,
} from './composables.ts'
