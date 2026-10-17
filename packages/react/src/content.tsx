import {
  MarkdownDocument,
  type MarkdownDocumentProps,
} from '@comark/react/components/MarkdownDocument'
import type { ReactElement } from 'react'

/** What `<HollwareContent>` renders: an entry as `getEntry` gives it. */
export interface HollwareContentProps {
  /** The entry, with its `document`: nothing renders without one. */
  readonly entry: { readonly document?: unknown } | null | undefined
  /**
   * Maps the names of the components in the entry (`::callout` is `Callout`) to the site's own
   * React components. An element with no mapping renders as the plain tag.
   */
  readonly components?: NonNullable<MarkdownDocumentProps['components']>
  /** A class for the wrapper `div`, next to Comark's own `comark-content`. */
  readonly className?: string
}

type Value = NonNullable<MarkdownDocumentProps['value']>

function isDocument(value: unknown): value is Value {
  return typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'nodes'))
}

/**
 * The body of an entry: the Comark document Hollware stored when it was written, rendered with
 * `@comark/react`. It is a plain component, so it renders on the server and hydrates in the
 * browser from the same document. Pass `components` to render Hollware's components as your own.
 */
export function HollwareContent({
  entry,
  components,
  className,
}: HollwareContentProps): ReactElement | null {
  const document = entry?.document
  if (!isDocument(document)) return null
  return <MarkdownDocument value={document} components={components} className={className} />
}
