import { imageOf } from '@hollware/client'
import { defineComponent, h, type PropType } from 'vue'

export default defineComponent({
  name: 'HollwareImage',
  props: {
    entry: {
      type: Object as PropType<Parameters<typeof imageOf>[0]>,
      default: null,
    },
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
