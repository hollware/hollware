import { defineEventHandler, getRouterParam } from 'h3'
import { answer, forPage } from '../answer.ts'
import { useHollware } from '../reader.ts'

export default defineEventHandler(async (event) => {
  const { site, reader } = useHollware(event)
  const group = await answer(event, () =>
    reader.getTranslations(
      site,
      getRouterParam(event, 'collection') ?? '',
      getRouterParam(event, 'group') ?? '',
    ),
  )
  return { outcome: group.outcome, entries: (group.entries ?? []).map(forPage) }
})
