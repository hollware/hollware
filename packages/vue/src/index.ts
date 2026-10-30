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
  type CollectionNavigation,
  type EntryAnswer,
  type EntryPage,
  type GetEntryOptions,
  type Hollware,
  type HollwareOptions,
  type HollwareReader,
  type ImageAttributes,
  type ListEntriesOptions,
  type NavigationEntry,
  type NavigationGroup,
  type NavigationOptions,
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
  useHollwareNavigation,
  type HollwareState,
} from './composables.ts'
