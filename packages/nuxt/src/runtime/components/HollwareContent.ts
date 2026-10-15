import { MarkdownDocument } from '@comark/vue'
import { defineComponent, h, type PropType } from 'vue'

/**
 * The body of an entry: the Comark document Hollware stored when it was written, rendered with
 * `@comark/vue`. `components` maps the names of the entry's components to the site's own.
 */
export default defineComponent({
  name: 'HollwareContent',
  props: {
    /** An entry as `useHollwareEntry` gives it, with its `document`. */
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
