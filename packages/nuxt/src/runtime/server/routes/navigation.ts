import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { answer } from '../answer.ts'
import { useHollware } from '../reader.ts'

export default defineEventHandler((event) => {
  const { site, reader } = useHollware(event)
  const locale = getQuery(event)['locale']
  return answer(event, () =>
    reader.getNavigation(
      site,
      getRouterParam(event, 'collection') ?? '',
      typeof locale === 'string' && locale !== '' ? { locale } : {},
    ),
  )
})
