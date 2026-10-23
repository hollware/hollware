import { createError, defineEventHandler, getRequestURL, setResponseHeader } from 'h3'

const MARKDOWN_PATH = /^(\/es)?\/docs\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/

export default defineEventHandler(async (event) => {
  const match = MARKDOWN_PATH.exec(getRequestURL(event).pathname)
  const slug = match?.[2]
  if (match === null || slug === undefined) return
  const locale = match[1] === undefined ? 'en' : 'es'
  const { site, reader } = useHollware(event)
  const found = await reader.getEntry(site, 'docs', slug, locale, { formats: ['markdown'] })
  if (found.outcome !== 'ok' || typeof found.entry?.markdown !== 'string') {
    throw createError({ statusCode: 404, statusMessage: 'No such page' })
  }
  setResponseHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  return found.entry.markdown
})
