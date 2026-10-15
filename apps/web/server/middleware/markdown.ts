import { createError, defineEventHandler, getRequestURL, setResponseHeader } from 'h3'

const MARKDOWN_PATH = /^\/docs\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/

/** `/docs/<slug>.md`: a page of the docs as the Markdown it was written in, for agents. */
export default defineEventHandler(async (event) => {
  const slug = MARKDOWN_PATH.exec(getRequestURL(event).pathname)?.[1]
  if (slug === undefined) return
  const { site, reader } = useHollware(event)
  const found = await reader.getEntry(site, 'docs', slug, 'en', { formats: ['markdown'] })
  if (found.outcome !== 'ok' || typeof found.entry?.markdown !== 'string') {
    throw createError({ statusCode: 404, statusMessage: 'No such page' })
  }
  setResponseHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  return found.entry.markdown
})
