// What a SITE pays to render a stored document: the render side of @comark/html only, no parser.
import { isMarkdownDocument } from 'comark/utils'
import { renderHtmlFromDocument } from '@comark/html/render'

export default {
  async fetch(request: Request): Promise<Response> {
    const body: unknown = await request.json()
    if (!isMarkdownDocument(body)) return new Response('not a document', { status: 400 })
    return new Response(await renderHtmlFromDocument(body), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  },
}
