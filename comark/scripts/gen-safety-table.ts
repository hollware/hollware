// Prints, as JSON, what the three renderers of S3e (defaults, security(), src/safe.ts) produce for the
// inputs below. test/support/safety-table.ts was made from this output ONCE and every row was read by
// hand; the tests compare live output with those committed literals, never with a rerun of this script.
//   node scripts/gen-safety-table.ts > table.json
import { createHtmlRenderer, renderHtmlFromDocument } from '@comark/html'
import security from '@comark/html/plugins/security'
import { createSafeParser } from '../src/safe.ts'

const plain = createHtmlRenderer()
const secured = createHtmlRenderer({ plugins: [security()] })
const safeParse = createSafeParser(['callout', 'badge'])
const safe = async (md: string) => renderHtmlFromDocument(await safeParse(md))

const cases: Array<[string, string]> = [
  ['raw block script', '<script>alert(1)</script>'],
  ['raw inline script', 'before <script>alert(1)</script> after'],
  ['raw img onerror', '<img src=x onerror=alert(1)>'],
  ['raw a javascript href', '<a href="javascript:alert(1)">x</a>'],
  ['raw iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ['raw style', '<style>body{display:none}</style>'],
  ['raw comment', '<!-- hidden -->\n\nafter'],
  ['markdown link javascript:', '[x](javascript:alert(1))'],
  ['markdown image javascript:', '![x](javascript:alert(1))'],
  ['markdown link entity-encoded javascript:', '[x](&#106;avascript:alert(1))'],
  ['markdown link data:text/html', '[x](data:text/html,hello)'],
  ['markdown link attribute href', '[x](/a){href="javascript:alert(1)"}'],
  ['markdown link attribute onclick', '[x](/a){onclick="alert(1)"}'],
  [
    'block component href + onclick',
    '::callout{href="javascript:alert(1)" onclick="alert(1)"}\nbody\n::',
  ],
  [
    'inline component href + onclick',
    'x :badge[y]{href="javascript:alert(1)" onclick="alert(1)"} z',
  ],
  ['component binding :href', '::callout{:href="javascript:alert(1)"}\nbody\n::'],
  ['component innerHTML prop', '::callout{innerHTML="<img src=x onerror=alert(1)>"}\nbody\n::'],
  ['component prop with quote and tag', `::callout{title='"><script>alert(1)</script>'}\nbody\n::`],
  ['component named script', '::script\nalert(1)\n::'],
  ['inline component named script', 'x :script[alert(1)] y'],
  ['component named iframe', '::iframe{src="https://evil.example/x"}\n::'],
]
const out: Record<string, { markdown: string; plain: string; security: string; safe: string }> = {}
const warn = console.warn
console.warn = () => {}
for (const [name, md] of cases) {
  out[name] = {
    markdown: md,
    plain: await plain(md),
    security: await secured(md),
    safe: await safe(md),
  }
}
console.warn = warn
console.log(JSON.stringify(out, null, 2))
