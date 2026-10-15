import { defineEventHandler, getRouterParam } from 'h3'
import { answer, forPage } from '../answer.ts'
import { useHollware } from '../reader.ts'

export default defineEventHandler(async (event) => {
  const { site, reader } = useHollware(event)
  const param = (name: string) => getRouterParam(event, name) ?? ''
  const found = await answer(event, () =>
    reader.getEntry(site, param('collection'), param('slug'), param('locale'), {
      // The Comark document, which <HollwareContent> renders.
      formats: ['document'],
    }),
  )
  return { outcome: found.outcome, entry: forPage(found.entry) }
})
