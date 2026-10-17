import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { previewOf } from '../../tags.ts'
import { answer, forPage } from '../answer.ts'
import { useHollware } from '../reader.ts'

export default defineEventHandler(async (event) => {
  const { site, reader } = useHollware(event)
  const param = (name: string) => getRouterParam(event, name) ?? ''
  const preview = previewOf(getQuery(event))
  const found = await answer(event, () =>
    reader.getEntry(site, param('collection'), param('slug'), param('locale'), {
      // The Comark document, which <HollwareContent> renders.
      formats: ['document'],
      // The token of a page opened from the admin: the latest revision of its entry.
      ...(preview === undefined ? {} : { preview }),
    }),
  )
  return { outcome: found.outcome, entry: forPage(found.entry) }
})
