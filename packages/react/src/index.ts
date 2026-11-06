export const name = '@hollware/react'

export {
  createHollware,
  flattenNavigation,
  hollwareBinding,
  imageOf,
  isPreviewRequest,
  PREVIEW_COOKIE,
  previewCookieClear,
  previewHeaders,
  previewRedirect,
  trailOf,
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
  type PageAncestor,
  type PageAnswer,
  type PageDocument,
  type PageEntry,
  type PageImage,
  type PageSummary,
  type ReaderOptions,
  type Translation,
} from '@hollware/client'
export { HollwareContent, type HollwareContentProps } from './content.tsx'
export { HollwareImage, type HollwareImageProps } from './image.tsx'
export {
  HollwareBreadcrumbs,
  HollwareTree,
  type HollwareBreadcrumbsProps,
  type HollwareLinkComponent,
  type HollwareTreeProps,
} from './tree.tsx'
