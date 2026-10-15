import { defineEventHandler } from 'h3'
import { answer } from '../answer.ts'
import { useHollware } from '../reader.ts'

export default defineEventHandler((event) => {
  const { site, reader } = useHollware(event)
  return answer(event, () => reader.describeSite(site))
})
