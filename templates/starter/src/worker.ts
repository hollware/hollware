import { createHollware } from '@hollware/server'

const hollware = createHollware()

export default {
  fetch: hollware.fetch,
  scheduled: hollware.scheduled,
  queue: hollware.queue,
} satisfies ExportedHandler<Env>

export class Hollware extends hollware.Hollware {}
