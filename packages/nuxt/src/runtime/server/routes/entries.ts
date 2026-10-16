import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { answer, forPage } from '../answer.ts'
import { useHollware } from '../reader.ts'

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)

export default defineEventHandler(async (event) => {
  const { site, reader } = useHollware(event)
  const query = getQuery(event)
  const [locale, tag, cursor, limit] = ['locale', 'tag', 'cursor', 'limit'].map((key) =>
    text(query[key]),
  )
  const options = {
    ...(locale === undefined ? {} : { locale }),
    ...(tag === undefined ? {} : { tag }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit: Number(limit) }),
  }
  const page = await answer(event, () =>
    reader.listEntries(site, getRouterParam(event, 'collection') ?? '', options),
  )
  const entries = page.entries.map(forPage).flatMap((entry) => (entry === undefined ? [] : [entry]))
  return { outcome: page.outcome, entries, nextCursor: page.nextCursor }
})
