import { renderToReadableStream } from 'react-dom/server'
import type { EntryContext } from 'react-router'
import { ServerRouter } from 'react-router'

export default async function handleRequest(
  request: Request,
  status: number,
  headers: Headers,
  context: EntryContext,
) {
  if (request.method === 'HEAD') return new Response(null, { status, headers })
  const body = await renderToReadableStream(<ServerRouter context={context} url={request.url} />)
  await body.allReady
  headers.set('content-type', 'text/html')
  return new Response(body, { status, headers })
}
