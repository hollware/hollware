import { imageOf } from '@hollware/client'
import type { ImgHTMLAttributes, ReactElement } from 'react'

/** What `<HollwareImage>` takes: an entry, the frontmatter field of its image, and any `<img>` prop. */
export type HollwareImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  /** An entry or a summary as `getEntry` or `listEntries` gives it: its frontmatter and images. */
  readonly entry: Parameters<typeof imageOf>[0]
  /** The frontmatter field that holds the image, such as `img` or `cover`. */
  readonly field: string
}

/**
 * The image a frontmatter field holds, such as the cover of a post: an `<img>` with its alt, its
 * size and the `srcset` of the copies Hollware made of it, so the page keeps its room while it
 * loads and a phone loads a small one. Any prop given wins, `alt` and `sizes` included. Nothing
 * renders when the field holds no image.
 */
export function HollwareImage({ entry, field, ...rest }: HollwareImageProps): ReactElement | null {
  const image = imageOf(entry, field)
  if (image === null) return null
  return (
    <img
      src={image.src}
      alt={image.alt ?? ''}
      srcSet={image.srcset}
      sizes={image.sizes}
      width={image.width}
      height={image.height}
      {...rest}
    />
  )
}
