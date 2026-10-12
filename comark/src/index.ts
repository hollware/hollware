import { renderHtmlFromDocument } from '@comark/html'
import { createMarkdownParser } from 'comark'
import { isMarkdownDocument } from 'comark/utils'
import { COMARK_VERSION } from './versions.ts'
import { parseDocument, processMarkdown, renderDocument } from './pipeline.ts'
import { createSafeParser } from './safe.ts'

// The configuration proposed in src/safe.ts, built once per isolate like the default parser.
const safeParser = createSafeParser(['callout', 'badge'])

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url)
    if (request.method === 'GET' && pathname === '/health') {
      return Response.json({ ok: true, comark: COMARK_VERSION })
    }
    if (request.method === 'GET' && pathname === '/runtime') {
      // Runs the library AND reports which Node.js globals this isolate has, in one request: the
      // no-compat checks read `typeofProcess` back ("undefined") next to a document that was really
      // parsed and rendered here.
      const { document, extracted } = await processMarkdown('# Runtime check\n\nA [link](/a/).')
      return Response.json({
        typeofProcess: typeof Reflect.get(globalThis, 'process'),
        typeofBuffer: typeof Reflect.get(globalThis, 'Buffer'),
        typeofSetImmediate: typeof Reflect.get(globalThis, 'setImmediate'),
        headings: extracted.headings,
        html: await renderDocument(document),
      })
    }
    if (request.method === 'POST' && pathname === '/process') {
      // Markdown in; frontmatter, extracted data and HTML out.
      const markdown = await request.text()
      const { document, extracted } = await processMarkdown(markdown)
      return Response.json({
        frontmatter: document.frontmatter,
        extracted,
        html: await renderDocument(document),
      })
    }
    if (request.method === 'POST' && pathname === '/safe') {
      // Markdown in; HTML out, through the safe configuration (no raw HTML, tag allow-list).
      const document = await safeParser(await request.text())
      return new Response(await renderHtmlFromDocument(document), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    if (request.method === 'POST' && pathname === '/autoclose') {
      // Does a parse of this Markdown finish with comark's autoClose pass on, and with it off? A
      // stack overflow shows up as "RangeError" (see test/workerd/gotchas.workerd.test.ts).
      const markdown = await request.text()
      const outcome = async (autoClose: boolean): Promise<string> => {
        try {
          await createMarkdownParser({ autoClose })(markdown)
          return 'ok'
        } catch (error) {
          return error instanceof Error ? error.name : 'error'
        }
      }
      return Response.json({
        autoCloseOn: await outcome(true),
        autoCloseOff: await outcome(false),
      })
    }
    if (request.method === 'POST' && pathname === '/parse') {
      // Markdown in; the derived document (what would be stored next to the Markdown) out.
      return Response.json(await parseDocument(await request.text()))
    }
    if (request.method === 'POST' && pathname === '/render') {
      // A stored document in; HTML out, without parsing again.
      const body: unknown = await request.json()
      if (!isMarkdownDocument(body)) return new Response('not a document', { status: 400 })
      return new Response(await renderDocument(body), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
    return new Response('Not Found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
