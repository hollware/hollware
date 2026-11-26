import { createError, defineEventHandler, getRequestURL, setResponseHeader } from 'h3'
import { markdownTarget, pathOf, withFacts } from '../../app/utils/pages'
import { canonicalLinkOf } from '../../app/utils/seo'

export default defineEventHandler(async (event) => {
  const target = markdownTarget(getRequestURL(event).pathname)
  if (target === null) return
  const { site, reader } = useHollware(event)
  const home =
    target.collection === 'home'
      ? await reader.resolvePath(site, pathOf('home', '', target.locale)).catch(() => null)
      : null
  const slug =
    target.collection !== 'home' ? target.slug : home?.outcome === 'ok' ? home.slug : null
  const found =
    slug === null
      ? null
      : await reader.getEntry(site, target.collection, slug, target.locale, {
          formats: ['markdown'],
        })
  if (found === null || found.outcome !== 'ok' || typeof found.entry?.markdown !== 'string') {
    throw createError({ statusCode: 404, statusMessage: 'No such page' })
  }
  setResponseHeader(event, 'content-type', 'text/markdown; charset=utf-8')
  setResponseHeader(
    event,
    'link',
    canonicalLinkOf(pathOf(target.collection, target.slug, target.locale)),
  )
  return withFacts(found.entry.markdown)
})
