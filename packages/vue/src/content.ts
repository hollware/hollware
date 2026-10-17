import { MarkdownDocument } from '@comark/vue/components/MarkdownDocument'
import { defineComponent, h, type PropType } from 'vue'

/**
 * The body of an entry: the Comark document Hollware stored when it was written, rendered with
 * `@comark/vue`, imported from its own subpath so no Markdown parser reaches the bundle. It
 * renders on the server and hydrates in the browser from the same document. `components` maps
 * the names of the components in the entry (`::callout` is `Callout`) to the site's own Vue
 * components; an element with no mapping renders as the plain tag.
 */
export const HollwareContent = defineComponent({
  name: 'HollwareContent',
  props: {
    /** An entry as `getEntry` or `useHollwareEntry` gives it, with its `document`. */
    entry: {
      type: Object as PropType<{ readonly document?: unknown } | null | undefined>,
      default: null,
    },
    components: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) },
  },
  setup(props) {
    return () => {
      const document = props.entry?.document
      if (
        typeof document !== 'object' ||
        document === null ||
        !Array.isArray(Reflect.get(document, 'nodes'))
      ) {
        return null
      }
      return h(MarkdownDocument, { value: document as never, components: props.components })
    }
  },
})
