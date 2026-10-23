import { MarkdownDocument } from '@comark/vue'
import { defineComponent, h, type PropType } from 'vue'

export default defineComponent({
  name: 'HollwareContent',
  props: {
    entry: {
      type: Object as PropType<{ document?: unknown } | null | undefined>,
      default: null,
    },
    components: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) },
  },
  setup(props) {
    return () => {
      const document = props.entry?.document
      if (typeof document !== 'object' || document === null || !('nodes' in document)) return null
      return h(MarkdownDocument, { value: document as never, components: props.components })
    }
  },
})
