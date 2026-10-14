import { createHollware } from '@hollware/server'
import config from '../hollware.config.ts'

/**
 * Hollware as a user's Worker builds it: `createHollware(config)`, then its `fetch` and its
 * `Hollware` entrypoint. The conformance run starts it with `wrangler dev`.
 */
const hollware = createHollware(config)

export default {
  fetch: hollware.fetch,
  scheduled: hollware.scheduled,
} satisfies ExportedHandler<Env>

export class Hollware extends hollware.Hollware {}
