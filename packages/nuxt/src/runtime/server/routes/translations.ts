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
  const entries = (group.entries ?? [])
    .map(forPage)
    .flatMap((entry) => (entry === undefined ? [] : [entry]))
  return { outcome: group.outcome, entries }
})
