// Inputs and the exact HTML that three renderers produce for them (S3e). Literals read once from
// the output of @comark/html 0.7.0 and reviewed by hand, never recomputed by the code under test.
//   plain    = createHtmlRenderer()                                 the defaults
//   security = createHtmlRenderer({ plugins: [security()] })        the sanitizer with its defaults
//   safe     = createSafeParser(['callout', 'badge']) + renderHtmlFromDocument   src/safe.ts

export interface SafetyCase {
  name: string
  markdown: string
  plain: string
  security: string
  safe: string
}

export const SAFETY_CASES: SafetyCase[] = [
  {
    name: 'raw block script',
    markdown: '<script>alert(1)</script>',
    plain: '<script>\nalert(1)\n</script>',
    security: '<script>\nalert(1)\n</script>',
    safe: '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
  },
  {
    name: 'raw inline script',
    markdown: 'before <script>alert(1)</script> after',
    plain: '<p>\n  before <script>alert(1)</script> after\n</p>',
    security: '<p>\n  before <script>alert(1)</script> after\n</p>',
    safe: '<p>before &lt;script&gt;alert(1)&lt;/script&gt; after</p>',
  },
  {
    name: 'raw img onerror',
    markdown: '<img src=x onerror=alert(1)>',
    plain: '<img src="x" onerror="alert(1)">',
    security: '<img src="x">',
    safe: '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
  },
  {
    name: 'raw a javascript href',
    markdown: '<a href="javascript:alert(1)">x</a>',
    plain: '<p><a href="javascript:alert(1)">x</a></p>',
    security: '<p><a>x</a></p>',
    safe: '<p>&lt;a href="javascript:alert(1)"&gt;x&lt;/a&gt;</p>',
  },
  {
    name: 'raw iframe srcdoc',
    markdown: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    plain: '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
    security: '<iframe></iframe>',
    safe: '<p>&lt;iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"&gt;&lt;/iframe&gt;</p>',
  },
  {
    name: 'raw style',
    markdown: '<style>body{display:none}</style>',
    plain: '<style>\nbody{display:none}\n</style>',
    security: '<style>\nbody{display:none}\n</style>',
    safe: '<p>&lt;style&gt;body&lt;/style&gt;</p>',
  },
  {
    name: 'raw comment',
    markdown: '<!-- hidden -->\n\nafter',
    plain: '<!-- hidden -->\n<p>after</p>',
    security: '<!-- hidden -->\n<p>after</p>',
    safe: '<p>&lt;!-- hidden --&gt;</p>\n<p>after</p>',
  },
  {
    name: 'markdown link javascript:',
    markdown: '[x](javascript:alert(1))',
    plain: '<p>[x](javascript:alert(1))</p>',
    security: '<p>[x](javascript:alert(1))</p>',
    safe: '<p>[x](javascript:alert(1))</p>',
  },
  {
    name: 'markdown image javascript:',
    markdown: '![x](javascript:alert(1))',
    plain: '<p>![x](javascript:alert(1))</p>',
    security: '<p>![x](javascript:alert(1))</p>',
    safe: '<p>![x](javascript:alert(1))</p>',
  },
  {
    name: 'markdown link entity-encoded javascript:',
    markdown: '[x](&#106;avascript:alert(1))',
    plain: '<p>[x](javascript:alert(1))</p>',
    security: '<p>[x](javascript:alert(1))</p>',
    safe: '<p>[x](javascript:alert(1))</p>',
  },
  {
    name: 'markdown link data:text/html',
    markdown: '[x](data:text/html,hello)',
    plain: '<p>[x](data:text/html,hello)</p>',
    security: '<p>[x](data:text/html,hello)</p>',
    safe: '<p>[x](data:text/html,hello)</p>',
  },
  {
    name: 'markdown link attribute href',
    markdown: '[x](/a){href="javascript:alert(1)"}',
    plain: '<p><a href="javascript:alert(1)">x</a></p>',
    security: '<p><a>x</a></p>',
    safe: '<p><a>x</a></p>',
  },
  {
    name: 'markdown link attribute onclick',
    markdown: '[x](/a){onclick="alert(1)"}',
    plain: '<p><a href="/a" onclick="alert(1)">x</a></p>',
    security: '<p><a href="/a">x</a></p>',
    safe: '<p><a href="/a">x</a></p>',
  },
  {
    name: 'block component href + onclick',
    markdown: '::callout{href="javascript:alert(1)" onclick="alert(1)"}\nbody\n::',
    plain: '<callout href="javascript:alert(1)" onclick="alert(1)">\n  body\n</callout>',
    security: '<callout>\n  body\n</callout>',
    safe: '<callout>\n  body\n</callout>',
  },
  {
    name: 'inline component href + onclick',
    markdown: 'x :badge[y]{href="javascript:alert(1)" onclick="alert(1)"} z',
    plain: '<p>\n  x <badge href="javascript:alert(1)" onclick="alert(1)">y</badge> z\n</p>',
    security: '<p>\n  x <badge>y</badge> z\n</p>',
    safe: '<p>\n  x <badge>y</badge> z\n</p>',
  },
  {
    name: 'component binding :href',
    markdown: '::callout{:href="javascript:alert(1)"}\nbody\n::',
    plain: '<callout>\n  body\n</callout>',
    security: '<callout>\n  body\n</callout>',
    safe: '<callout>\n  body\n</callout>',
  },
  {
    name: 'component innerHTML prop',
    markdown: '::callout{innerHTML="<img src=x onerror=alert(1)>"}\nbody\n::',
    plain: '<callout>\n  body\n</callout>',
    security: '<callout>\n  body\n</callout>',
    safe: '<callout>\n  body\n</callout>',
  },
  {
    name: 'component prop with quote and tag',
    markdown: "::callout{title='\"><script>alert(1)</script>'}\nbody\n::",
    plain: '<callout title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">\n  body\n</callout>',
    security:
      '<callout title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">\n  body\n</callout>',
    safe: '<callout title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">\n  body\n</callout>',
  },
  {
    name: 'component named script',
    markdown: '::script\nalert(1)\n::',
    plain: '<script>\nalert(1)\n</script>',
    security: '<script>\nalert(1)\n</script>',
    safe: '',
  },
  {
    name: 'inline component named script',
    markdown: 'x :script[alert(1)] y',
    plain: '<p>\n  x <script>alert(1)</script> y\n</p>',
    security: '<p>\n  x <script>alert(1)</script> y\n</p>',
    safe: '<p>x  y</p>',
  },
  {
    name: 'component named iframe',
    markdown: '::iframe{src="https://evil.example/x"}\n::',
    plain: '<iframe src="https://evil.example/x"></iframe>',
    security: '<iframe src="https://evil.example/x"></iframe>',
    safe: '',
  },
]
