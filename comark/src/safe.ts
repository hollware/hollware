// The proposed safe configuration (S3e). Read from:
//   node_modules/comark/dist/parse.js          the default plugin list that registerDefaultPlugins:false drops
//   node_modules/comark/dist/plugins/security.{js,d.ts}   the sanitizer and its options
// What it does, and why each part is needed (every claim has a test in test/workerd/safety.workerd.test.ts):
// - No `html` plugin: raw HTML in the Markdown stays text, so it is escaped on output.
// - `security({ allowedTags })`: component syntax (`::script`, `:iframe[...]`) and attribute syntax
//   (`{onclick="..."}`) still create arbitrary tags and attributes without the html plugin. The plugin
//   removes every tag outside the allow-list (with its children) and every `on*`, `srcdoc`,
//   `formaction`, `innerHTML` attribute and every `javascript:` / `data:text/html` `href` or `src`.
import { createMarkdownParser } from 'comark'
import alert from 'comark/plugins/alert'
import attributes from 'comark/plugins/attributes'
import components from 'comark/plugins/components'
import frontmatter from 'comark/plugins/frontmatter'
import security from 'comark/plugins/security'
import taskList from 'comark/plugins/task-list'
import { NATIVE_TAGS } from './pipeline.ts'

/** The `as` value the alert plugin puts on a blockquote (`> [!NOTE]`). The security plugin checks it against the allow-list too. */
const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution']

/**
 * Same plugins and order as comark's defaults, minus `html`, plus `security` last.
 *
 * `autoClose` defaults to false here, unlike in comark. The auto-close pass exists for streaming
 * (LLM output): it completes unterminated syntax. For a CMS it hides the author's typos
 * (`[x](https://a` becomes a link to the made-up `comark:incomplete-link`, `:badge[x` leaks the text
 * `(comark:incomplete-link)`), and on hostile input it is quadratic (20,000 nested `>` take 508 ms
 * with it, 0.5 ms without) and overflows the stack (`*a ` x 5,000). See gotchas.workerd.test.ts.
 */
export function createSafeParser(
  componentNames: readonly string[],
  { autoClose = false }: { autoClose?: boolean } = {},
) {
  return createMarkdownParser({
    autoClose,
    registerDefaultPlugins: false,
    plugins: [
      frontmatter(),
      alert(),
      taskList(),
      components(),
      attributes(),
      security({ allowedTags: [...NATIVE_TAGS, ...ALERT_TYPES, ...componentNames] }),
    ],
  })
}
