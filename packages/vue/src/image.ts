import { imageOf } from '@hollware/client'
import { defineComponent, h, type PropType } from 'vue'

/**
 * The image a frontmatter field holds, such as the cover of a post: an `<img>` with its alt, its
 * size and the `srcset` of the copies Hollware made of it, so the page keeps its room while it
 * loads and a phone loads a small one. An attribute given on the component wins, `alt` and
 * `sizes` included. Nothing renders when the field holds no image.
 */
export const HollwareImage = defineComponent({
  name: 'HollwareImage',
  props: {
    /** An entry or a summary as `getEntry` or `useHollwareEntries` gives it. */
    entry: {
      type: Object as PropType<Parameters<typeof imageOf>[0]>,
      default: null,
    },
    /** The frontmatter field that holds the image, such as `img` or `cover`. */
    field: { type: String, required: true },
  },
  setup(props) {
    return () => {
      const image = imageOf(props.entry, props.field)
      if (image === null) return null
      return h('img', {
        src: image.src,
        alt: image.alt ?? '',
        srcset: image.srcset,
        sizes: image.sizes,
        width: image.width,
        height: image.height,
      })
    }
  },
})
