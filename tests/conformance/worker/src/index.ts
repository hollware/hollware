import { createHollware } from '@hollware/server'
import config from '../hollware.config.ts'

const hollware = createHollware(config)

export default {
  fetch: hollware.fetch,
  scheduled: hollware.scheduled,
  queue: hollware.queue,
} satisfies ExportedHandler<Env>

export class Hollware extends hollware.Hollware {}
export class HollwareOps extends hollware.HollwareOps {}
