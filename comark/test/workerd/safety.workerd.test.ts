import { createHtmlRenderer, renderHtmlFromDocument } from '@comark/html'
import security from '@comark/html/plugins/security'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSafeParser } from '../../src/safe.ts'
import { SAFETY_CASES } from '../support/safety-table.ts'

// S3e. Fails when: @comark/html starts escaping or stripping what it passes through today (then the
// "plain" column changes and the unsafe defaults are no longer unsafe), when the security plugin stops
// removing an attribute or tag, or when src/safe.ts stops being enough on its own (a case in the
// "safe" column then produces a script, an iframe, an event handler or a javascript: URL).

const plain = createHtmlRenderer()
const secured = createHtmlRenderer({ plugins: [security()] })
const safeParse = createSafeParser(['callout', 'badge'])

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  // The security plugin logs a console.warn line for every attribute it removes.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
})

describe.each(SAFETY_CASES)(
  '$name',
  ({ markdown, plain: expectedPlain, security: expectedSecurity, safe }) => {
    it('defaults of createHtmlRenderer()', async () => {
      expect(await plain(markdown)).toBe(expectedPlain)
    })

    it('with security() and its defaults', async () => {
      expect(await secured(markdown)).toBe(expectedSecurity)
    })

    it('with src/safe.ts: no html plugin and an allow-list of tags', async () => {
      expect(await renderHtmlFromDocument(await safeParse(markdown))).toBe(safe)
    })
  },
)

// Only real tags count: escaped text (`&lt;img onerror=...&gt;`) has no `<`.
function isUnsafe(html: string): boolean {
  return [
    /<(?:script|style|iframe|object|embed)\b/i,
    /<[^>]*\son[a-z]+\s*=/i,
    /<[^>]*\b(?:href|src)\s*=\s*["']\s*(?:javascript|vbscript|data:text\/html)/i,
  ].some((pattern) => pattern.test(html))
}

describe('the safe configuration over the whole corpus', () => {
  it('the predicate itself: it flags the defaults for exactly the cases that are dangerous', async () => {
    const flagged: string[] = []
    for (const { name, markdown } of SAFETY_CASES) {
      if (isUnsafe(await plain(markdown))) flagged.push(name)
    }

    expect(flagged).toStrictEqual([
      'raw block script',
      'raw inline script',
      'raw img onerror',
      'raw a javascript href',
      'raw iframe srcdoc',
      'raw style',
      'markdown link attribute href',
      'markdown link attribute onclick',
      'block component href + onclick',
      'inline component href + onclick',
      'component named script',
      'inline component named script',
      'component named iframe',
    ])
  })

  it('security() with its defaults still lets tags through (script, style, iframe)', async () => {
    const flagged: string[] = []
    for (const { name, markdown } of SAFETY_CASES) {
      if (isUnsafe(await secured(markdown))) flagged.push(name)
    }

    expect(flagged).toStrictEqual([
      'raw block script',
      'raw inline script',
      'raw iframe srcdoc',
      'raw style',
      'component named script',
      'inline component named script',
      'component named iframe',
    ])
  })

  it.each(SAFETY_CASES)('$name is safe with src/safe.ts', async ({ markdown }) => {
    expect(isUnsafe(await renderHtmlFromDocument(await safeParse(markdown)))).toBe(false)
  })
})

describe('what the security plugin logs', () => {
  it('writes one console.warn line per removed attribute', async () => {
    await secured('::callout{href="javascript:alert(1)" onclick="alert(1)"}\nbody\n::')

    expect(warn.mock.calls).toStrictEqual([
      ['[comark/plugins/security] removing unsafe attribute: href="javascript:alert(1)"'],
      ['[comark/plugins/security] removing unsafe attribute: onclick="alert(1)"'],
    ])
  })

  it('writes nothing for a tag it drops from the allow-list', async () => {
    await renderHtmlFromDocument(await safeParse('::script\nalert(1)\n::'))

    expect(warn.mock.calls).toStrictEqual([])
  })
})

describe('what the allow-list of src/safe.ts must not remove', () => {
  it('keeps GFM alerts, task lists, tables, code blocks and the registered components, and logs nothing', async () => {
    const document = await safeParse(
      '> [!NOTE]\n> Careful\n\n- [x] done\n\n| a |\n|---|\n| 1 |\n\n```ts\nconst a = 1\n```\n\n::callout{type="tip"}\nhi :badge[x]{tone="blue"}\n::',
    )

    expect(document.nodes.map((node) => (typeof node === 'string' ? node : node[0]))).toStrictEqual(
      ['blockquote', 'ul', 'table', 'pre', 'callout'],
    )
    expect(document.nodes[0]).toStrictEqual(['blockquote', { as: 'note' }, 'Careful'])
    expect(warn.mock.calls).toStrictEqual([])
  })
})

describe('the security plugin options', () => {
  it('blockedTags drops the tag with its children and leaves the rest', async () => {
    const render = createHtmlRenderer({ plugins: [security({ blockedTags: ['script'] })] })

    expect(await render('before <script>alert(1)</script> after')).toBe('<p>before  after</p>')
  })

  it('allowedTags with an unlisted native tag drops it too (the list must name every tag)', async () => {
    const render = createHtmlRenderer({ plugins: [security({ allowedTags: ['p'] })] })

    expect(await render('hello **bold**')).toBe('<p>hello </p>')
  })

  it('tagFallback replaces a dropped element', async () => {
    const render = createHtmlRenderer({
      plugins: [security({ blockedTags: ['script'], tagFallback: () => 'removed' })],
    })

    expect(await render('<script>alert(1)</script>')).toBe('removed')
  })

  it('allowedLinkPrefixes removes a link outside the list (raw HTML and attribute syntax)', async () => {
    const render = createHtmlRenderer({
      plugins: [security({ allowedLinkPrefixes: ['/', 'https://example.com/'] })],
    })

    expect(await render('<a href="https://evil.example/x">x</a> <a href="/ok">y</a>')).toBe(
      '<p><a>x</a> <a href="/ok">y</a></p>',
    )
  })
})
